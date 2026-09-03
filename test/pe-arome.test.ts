import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeAromeWcsCache } from "../src/cache/pe-arome-wcs-cache.js";
import {
  PE_AROME_MEMBERS,
  expandPeAromeRequestedFields,
  peAromeMemberNumber,
  sortPeAromeMembers,
} from "../src/catalog/pe-arome.js";
import { PeAromeForecastService } from "../src/core/pe-arome.js";
import { PeAromeRunResolver } from "../src/core/pe-arome-run.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";
import {
  buildPeAromeGetCoverageUrl,
  floorToPeAromeCycle,
  parsePeAromeRun,
  peAromeForecastHour,
  peAromeValidTime,
  resolvePeAromeWcsEndpoint,
} from "../src/sources/pe-arome.js";
import { resolveMeteoFranceBearerToken } from "../src/access/meteo-france-auth.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PE-AROME catalog and source semantics", () => {
  it("models the control plus 24 perturbations in deterministic order", () => {
    expect(PE_AROME_MEMBERS).toHaveLength(25);
    expect(PE_AROME_MEMBERS[0]).toBe("c00");
    expect(PE_AROME_MEMBERS.at(-1)).toBe("p24");
    expect(peAromeMemberNumber("c00")).toBe(0);
    expect(peAromeMemberNumber("p24")).toBe(24);
    expect(sortPeAromeMembers(["p24", "c00", "p02"])).toEqual(["c00", "p02", "p24"]);
  });

  it("uses the 03/09/15/21 UTC production cycles and 51-hour horizon", () => {
    expect(floorToPeAromeCycle(new Date("2026-09-01T14:59:59Z")).toISOString())
      .toBe("2026-09-01T09:00:00.000Z");
    expect(floorToPeAromeCycle(new Date("2026-09-01T15:00:00Z")).toISOString())
      .toBe("2026-09-01T15:00:00.000Z");
    expect(parsePeAromeRun("2026-09-01T09:00:00.000Z").toISOString())
      .toBe("2026-09-01T09:00:00.000Z");
    expect(() => parsePeAromeRun("2026-09-01T12:00:00.000Z"))
      .toThrow("03, 09, 15, or 21 UTC");

    const run = new Date("2026-09-01T09:00:00Z");
    expect(peAromeForecastHour(run, new Date("2026-09-03T12:00:00Z"))).toBe(51);
    expect(peAromeValidTime(run, 51).toISOString()).toBe("2026-09-03T12:00:00.000Z");
    expect(() => peAromeValidTime(run, 52)).toThrow("0 to 51");
  });

  it("builds one-field WCS coverage requests without exposing provider packaging publicly", () => {
    const field = expandPeAromeRequestedFields(["temperature_2m"])[0]!;
    const url = new URL(buildPeAromeGetCoverageUrl(
      "https://example.test/member-00/GetCoverage",
      {
        run: new Date("2026-09-01T09:00:00Z"),
        forecastHour: 6,
        field,
        subset: {
          westLongitude: 13.9,
          eastLongitude: 14.6,
          southLatitude: 49.8,
          northLatitude: 50.2,
        },
      },
    ));

    expect(url.pathname).toBe("/member-00/GetCoverage");
    expect(url.searchParams.get("coverageid"))
      .toBe("TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___2026-09-01T09.00.00Z");
    expect(url.searchParams.getAll("subset")).toEqual([
      "long(13.9,14.6)",
      "lat(49.8,50.2)",
      "time(2026-09-01T15:00:00.000Z)",
      "height(2)",
    ]);
    expect(url.searchParams.get("format")).toBe("application/wmo-grib");
  });

  it("resolves subscribed member endpoints and bearer auth from environment", () => {
    expect(resolvePeAromeWcsEndpoint("p03", {
      WFG_PEAROME_WCS_URL_TEMPLATE:
        "https://example.test/pe-arome/{member_number_2}/{member}/wcs",
    } as NodeJS.ProcessEnv)).toBe("https://example.test/pe-arome/03/p03/wcs");

    expect(resolvePeAromeWcsEndpoint("c00", {
      WFG_PEAROME_WCS_ENDPOINTS: JSON.stringify({
        c00: "https://example.test/control/wcs",
      }),
    } as NodeJS.ProcessEnv)).toBe("https://example.test/control/wcs");

    expect(resolveMeteoFranceBearerToken({
      WFG_METEO_FRANCE_TOKEN: " token-value ",
    } as NodeJS.ProcessEnv)).toBe("token-value");

    expect(() => resolvePeAromeWcsEndpoint("p01", {} as NodeJS.ProcessEnv))
      .toThrow("WFG_PEAROME_WCS_URL_TEMPLATE");
    expect(() => resolveMeteoFranceBearerToken({} as NodeJS.ProcessEnv))
      .toThrow("WFG_METEO_FRANCE_TOKEN");
  });
});

describe("PE-AROME WCS cache", () => {
  it("authenticates, subsets, combines requested raw fields, and caches the GRIB", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-pe-arome-"));
    roots.push(root);
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        authorization: headers.get("authorization"),
      });
      return new Response(new TextEncoder().encode("GRIB-test"), { status: 200 });
    }) as unknown as typeof fetch;

    const cache = new PeAromeWcsCache(root, "p01", {
      endpoint: "https://example.test/member/wcs",
      token: "secret",
      fetchFn,
      accessPolicy: { run: async (operation) => operation() },
    });
    const fields = expandPeAromeRequestedFields(["temperature_2m", "relative_humidity_2m"]);
    const request = {
      run: new Date("2026-09-01T09:00:00Z"),
      forecastHour: 3,
      fields,
      subset: {
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49.8,
        northLatitude: 50.2,
      },
    };

    const first = await cache.fetch(request);
    expect(first.cacheHit).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(requests.every((entry) => entry.authorization === "Bearer secret")).toBe(true);
    expect(requests.every((entry) => entry.url.includes("subset=long%2814%2C14.5%29"))).toBe(true);
    expect(new TextDecoder().decode(await readFile(first.path))).toBe("GRIB-testGRIB-test");

    const second = await cache.fetch(request);
    expect(second).toEqual({ path: first.path, cacheHit: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("treats 403/404 as unavailable but surfaces expired credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-pe-arome-probe-"));
    roots.push(root);
    const makeCache = (status: number) => new PeAromeWcsCache(root, "c00", {
      endpoint: "https://example.test/member/wcs",
      token: "secret",
      fetchFn: vi.fn(async () => new Response("", { status })) as unknown as typeof fetch,
      accessPolicy: { run: async (operation) => operation() },
    });

    await expect(makeCache(403).isForecastAvailable(
      new Date("2026-09-01T09:00:00Z"),
      6,
      { sp1: true, hp1: false },
    )).resolves.toBe(false);
    await expect(makeCache(401).isForecastAvailable(
      new Date("2026-09-01T09:00:00Z"),
      6,
      { sp1: true, hp1: false },
    )).rejects.toThrow("rejected the bearer token");
  });
});

describe("PE-AROME run resolution", () => {
  it("pins the latest eligible PE cycle by probing the requested valid time", async () => {
    const probe = {
      isForecastAvailable: vi.fn(async (run: Date, forecastHour: number) =>
        run.toISOString() === "2026-09-01T09:00:00.000Z" && forecastHour === 3),
    };
    const resolver = new PeAromeRunResolver(
      probe,
      () => new Date("2026-09-01T10:15:00Z").getTime(),
    );

    await expect(resolver.resolveLatestRun({
      type: "valid_time",
      validTime: new Date("2026-09-01T12:00:00Z"),
      products: { sp1: true, hp1: false },
    })).resolves.toEqual(new Date("2026-09-01T09:00:00Z"));
    expect(probe.isForecastAvailable).toHaveBeenCalledWith(
      new Date("2026-09-01T09:00:00Z"),
      3,
      { sp1: true, hp1: false },
    );
  });
});

describe("PE-AROME member-first unified aggregation", () => {
  it("pins one resolved run, then aggregates member field distributions", async () => {
    const calls: Array<{ member: string; request: any }> = [];
    const service = new PeAromeForecastService({
      concurrency: 2,
      memberServiceFactory: (member) => ({
        query: vi.fn(async (request: any) => {
          calls.push({ member, request });
          const offset = member === "c00" ? 0 : 2;
          return {
            model: "arome_0p01",
            run: "2026-09-01T09:00:00.000Z",
            validTime: "2026-09-01T12:00:00.000Z",
            forecastHour: 3,
            requestedPoint: request.geometry,
            gridPoint: { latitude: 50.08, longitude: 14.42 },
            levels: [],
            fields: [{
              id: "temperature_2m",
              level: { type: "height_above_ground_m", heightM: 2 },
              temporal: { type: "instantaneous" },
              values: {
                temperatureC: 5 + offset,
              },
            }],
            source: {
              provider: "Météo-France Open Data",
              access: "meteo_france_open_data",
              decoder: "wgrib2",
              cacheHit: true,
            },
          };
        }),
      }),
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "pe-arome",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-01T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      ensemble: {
        members: ["p01", "c00"],
        quantiles: [0.5],
        includeMembers: true,
      },
    })) as any;

    expect(result.model).toBe("pe_arome_0p025");
    expect(result.selection.members).toEqual(["c00", "p01"]);
    expect(result.fieldSummaries[0].outputs.find((output: any) =>
      output.field === "temperatureC",
    ).distribution).toMatchObject({
      memberCount: 2,
      mean: 6,
      min: 5,
      max: 7,
    });
    expect(result.members).toHaveLength(2);
    expect(result.source).toMatchObject({
      provider: "Météo-France Public API",
      access: "meteo_france_wcs",
      memberCount: 2,
      samplingGrid: { resolutionDegrees: 0.025 },
    });

    expect(calls[0]).toMatchObject({
      member: "c00",
      request: {
        dataset: "arome",
        forecast: { run: "latest" },
      },
    });
    expect(calls[1]).toMatchObject({
      member: "p01",
      request: {
        dataset: "arome",
        forecast: { run: "2026-09-01T09:00:00.000Z" },
      },
    });
  });

  it("defaults to the native population and rejects invalid member selections", async () => {
    const service = new PeAromeForecastService({
      memberServiceFactory: () => ({
        query: vi.fn(async () => ({
          model: "arome_0p01",
          run: "2026-09-01T09:00:00.000Z",
          validTime: "2026-09-01T12:00:00.000Z",
          forecastHour: 3,
          requestedPoint: { latitude: 50, longitude: 14 },
          gridPoint: { latitude: 50, longitude: 14 },
          levels: [],
          fields: [{
            id: "temperature_2m",
            level: { type: "height_above_ground_m", heightM: 2 },
            temporal: { type: "instantaneous" },
            values: { temperatureC: 10 },
          }],
          source: { cacheHit: true },
        })),
      }),
    });
    const base = {
      dataset: "pe-arome",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-09-01T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
    };

    const result = await service.query(queryAtmosphereSchema.parse(base)) as any;
    expect(result.selection.members).toEqual(PE_AROME_MEMBERS);
    expect(result.selection.quantiles).toEqual([0.1, 0.5, 0.9]);

    await expect(service.query({
      ...base,
      ensemble: { members: ["c00", "bogus"] },
    } as any)).rejects.toThrow("unsupported: bogus");
    await expect(service.query({
      ...base,
      ensemble: { members: ["c00"] },
    } as any)).rejects.toThrow("requires at least two selected members");
  });
});

describe("PE-AROME unified capability validation", () => {
  it("accepts verified fields and rejects pressure selections and derived area fields", () => {
    expect(queryAtmosphereSchema.safeParse({
      dataset: "pe-arome",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-09-01T12:00:00Z" },
      selection: { fields: ["temperature_2m", "relative_humidity_2m"] },
      ensemble: { members: ["c00", "p01"] },
    }).success).toBe(true);

    const pressure = queryAtmosphereSchema.safeParse({
      dataset: "pe-arome",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-09-01T12:00:00Z" },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });
    expect(pressure.success).toBe(false);
    if (!pressure.success) {
      expect(pressure.error.issues.some((issue) =>
        issue.message.includes("near-surface WCS field slice"))).toBe(true);
    }

    const areaWind = queryAtmosphereSchema.safeParse({
      dataset: "pe-arome",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49.8,
        northLatitude: 50.2,
      },
      time: { at: "2026-09-01T12:00:00Z" },
      selection: { fields: ["wind_10m"] },
    });
    expect(areaWind.success).toBe(false);
  });
});
