import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeAromeWcsCache } from "../src/cache/pe-arome-wcs-cache.js";
import { expandPeAromeRequestedFields } from "../src/catalog/pe-arome.js";
import {
  PeAromeRunResolver,
  resolvePeAromeRun,
} from "../src/core/pe-arome-run.js";
import {
  buildPeAromeGetCoverageUrl,
  parsePeAromeRun,
  peAromeForecastHour,
  peAromeNativeForecastHoursInRange,
  peAromeValidTime,
  resolvePeAromeWcsEndpoint,
} from "../src/sources/pe-arome.js";
import { resolveMeteoFranceBearerToken } from "../src/access/meteo-france-auth.js";

const roots: string[] = [];
const products = { sp1: true, hp1: false };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PE-AROME source defensive branches", () => {
  it("rejects malformed run, cadence, horizon, and range inputs", () => {
    expect(() => parsePeAromeRun("2026-09-01T09:00:00Z"))
      .toThrow("canonical timezone-aware ISO instant");

    const run = new Date("2026-09-01T09:00:00Z");
    expect(() => peAromeForecastHour(run, new Date("2026-09-01T09:30:00Z")))
      .toThrow("native hourly forecast cadence");
    expect(() => peAromeForecastHour(run, new Date("2026-09-01T08:00:00Z")))
      .toThrow("between 0 and 51");
    expect(() => peAromeValidTime(run, 1.5))
      .toThrow("integer from 0 to 51");
    expect(() => peAromeNativeForecastHoursInRange(
      run,
      new Date("2026-09-01T12:00:00Z"),
      new Date("2026-09-01T11:00:00Z"),
    )).toThrow("endTime must be at or after startTime");
    expect(() => peAromeNativeForecastHoursInRange(
      run,
      new Date("2026-09-03T13:00:00Z"),
      new Date("2026-09-03T14:00:00Z"),
    )).toThrow("No native PE-AROME forecast outputs");
  });

  it("covers WCS endpoint normalization and unsupported coverage mapping", () => {
    const field = expandPeAromeRequestedFields(["temperature_2m"])[0]!;
    const url = new URL(buildPeAromeGetCoverageUrl(
      "https://example.test/wcs/",
      {
        run: new Date("2026-09-01T09:00:00Z"),
        forecastHour: 0,
        field,
        subset: {
          westLongitude: 14,
          eastLongitude: 15,
          southLatitude: 49,
          northLatitude: 50,
        },
      },
    ));
    expect(url.pathname).toBe("/wcs/GetCoverage");

    expect(() => buildPeAromeGetCoverageUrl(
      "https://example.test/wcs",
      {
        run: new Date("2026-09-01T09:00:00Z"),
        forecastHour: 0,
        field: { id: "wind_10m" } as any,
        subset: {
          westLongitude: 14,
          eastLongitude: 15,
          southLatitude: 49,
          northLatitude: 50,
        },
      },
    )).toThrow("coverage mapping is not defined");
  });

  it("fails clearly for malformed subscribed endpoint and credential configuration", () => {
    expect(() => resolvePeAromeWcsEndpoint("c00", {
      WFG_PEAROME_WCS_ENDPOINTS: "{bad-json",
    } as NodeJS.ProcessEnv)).toThrow("must be a JSON object");

    expect(() => resolvePeAromeWcsEndpoint("p01", {
      WFG_PEAROME_WCS_ENDPOINTS: JSON.stringify({
        c00: "https://example.test/control",
      }),
    } as NodeJS.ProcessEnv)).toThrow("no endpoint for member=p01");

    expect(() => resolveMeteoFranceBearerToken({
      WFG_METEO_FRANCE_TOKEN: "   ",
    } as NodeJS.ProcessEnv)).toThrow("WFG_METEO_FRANCE_TOKEN");
  });
});

describe("PE-AROME WCS cache defensive branches", () => {
  it("covers availability success, missing data, and non-auth upstream errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-pe-arome-availability-"));
    roots.push(root);

    const cacheFor = (status: number) => new PeAromeWcsCache(root, "c00", {
      endpoint: "https://example.test/wcs",
      token: "secret",
      fetchFn: vi.fn(async () => new Response("", { status })) as unknown as typeof fetch,
      accessPolicy: { run: async (operation) => operation() },
    });

    await expect(cacheFor(404).isForecastAvailable(
      new Date("2026-09-01T09:00:00Z"),
      6,
      products,
    )).resolves.toBe(false);

    await expect(cacheFor(200).isForecastAvailable(
      new Date("2026-09-01T09:00:00Z"),
      6,
      products,
    )).resolves.toBe(true);

    await expect(cacheFor(418).isForecastAvailable(
      new Date("2026-09-01T09:00:00Z"),
      6,
      products,
    )).rejects.toThrow("availability request failed: HTTP 418");
  });

  it("rejects empty requests, failed downloads, and non-GRIB payloads", async () => {
    const field = expandPeAromeRequestedFields(["temperature_2m"])[0]!;

    const emptyRoot = await mkdtemp(join(tmpdir(), "wfg-pe-arome-empty-"));
    roots.push(emptyRoot);
    const emptyCache = new PeAromeWcsCache(emptyRoot, "c00", {
      endpoint: "https://example.test/wcs",
      token: "secret",
      fetchFn: vi.fn() as unknown as typeof fetch,
      accessPolicy: { run: async (operation) => operation() },
    });
    await expect(emptyCache.fetch({
      run: new Date("2026-09-01T09:00:00Z"),
      forecastHour: 0,
      fields: [],
    })).rejects.toThrow("at least one supported field");

    const failedRoot = await mkdtemp(join(tmpdir(), "wfg-pe-arome-failed-"));
    roots.push(failedRoot);
    const failedCache = new PeAromeWcsCache(failedRoot, "p01", {
      endpoint: "https://example.test/wcs",
      token: "secret",
      fetchFn: vi.fn(async () => new Response("", { status: 400 })) as unknown as typeof fetch,
      accessPolicy: { run: async (operation) => operation() },
    });
    await expect(failedCache.fetch({
      run: new Date("2026-09-01T09:00:00Z"),
      forecastHour: 1,
      fields: [field],
    })).rejects.toThrow("WCS request failed: HTTP 400");

    const invalidRoot = await mkdtemp(join(tmpdir(), "wfg-pe-arome-invalid-"));
    roots.push(invalidRoot);
    const invalidCache = new PeAromeWcsCache(invalidRoot, "p02", {
      endpointProvider: () => "https://example.test/wcs",
      tokenProvider: async () => "secret",
      fetchFn: vi.fn(async () =>
        new Response(new TextEncoder().encode("NOPE"), { status: 200 })) as unknown as typeof fetch,
      accessPolicy: { run: async (operation) => operation() },
    });
    await expect(invalidCache.fetch({
      run: new Date("2026-09-01T09:00:00Z"),
      forecastHour: 2,
      fields: [field],
    })).rejects.toThrow("did not start with GRIB");
  });

  it("uses the full PE domain when no geometry subset is supplied", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-pe-arome-domain-"));
    roots.push(root);
    let requestedUrl = "";
    const cache = new PeAromeWcsCache(root, "p03", {
      endpoint: "https://example.test/wcs",
      token: "secret",
      fetchFn: vi.fn(async (input: string | URL) => {
        requestedUrl = String(input);
        return new Response(new TextEncoder().encode("GRIB-test"), { status: 200 });
      }) as unknown as typeof fetch,
      accessPolicy: { run: async (operation) => operation() },
    });

    await cache.fetch({
      run: new Date("2026-09-01T09:00:00Z"),
      forecastHour: 0,
      fields: expandPeAromeRequestedFields(["temperature_2m"]),
    });

    const subsets = new URL(requestedUrl).searchParams.getAll("subset");
    expect(subsets).toContain("long(-12,16)");
    expect(subsets).toContain("lat(37.5,55.4)");
  });
});

describe("PE-AROME run resolver branches", () => {
  it("scans older cycles and caches a latest valid-time resolution", async () => {
    const probe = {
      isForecastAvailable: vi.fn(async (run: Date, forecastHour: number) =>
        run.toISOString() === "2026-09-01T09:00:00.000Z" && forecastHour === 9),
    };
    const resolver = new PeAromeRunResolver(
      probe,
      () => new Date("2026-09-01T22:00:00Z").getTime(),
    );
    const requirement = {
      type: "valid_time" as const,
      validTime: new Date("2026-09-01T18:00:00Z"),
      products,
    };

    await expect(resolver.resolveLatestRun(requirement))
      .resolves.toEqual(new Date("2026-09-01T09:00:00Z"));
    const callsAfterFirstResolution = probe.isForecastAvailable.mock.calls.length;
    await expect(resolver.resolveLatestRun(requirement))
      .resolves.toEqual(new Date("2026-09-01T09:00:00Z"));
    expect(probe.isForecastAvailable).toHaveBeenCalledTimes(callsAfterFirstResolution);
  });

  it("resolves multi-output and single-output time ranges", async () => {
    const multiProbe = {
      isForecastAvailable: vi.fn(async () => true),
    };
    const multiResolver = new PeAromeRunResolver(
      multiProbe,
      () => new Date("2026-09-01T10:00:00Z").getTime(),
    );
    await expect(multiResolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-09-01T10:00:00Z"),
      endTime: new Date("2026-09-01T12:00:00Z"),
      products,
    })).resolves.toEqual(new Date("2026-09-01T09:00:00Z"));
    expect(multiProbe.isForecastAvailable).toHaveBeenCalledTimes(2);

    const singleProbe = {
      isForecastAvailable: vi.fn(async () => true),
    };
    const singleResolver = new PeAromeRunResolver(
      singleProbe,
      () => new Date("2026-09-01T10:00:00Z").getTime(),
    );
    await expect(singleResolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-09-01T10:00:00Z"),
      endTime: new Date("2026-09-01T10:00:00Z"),
      products,
    })).resolves.toEqual(new Date("2026-09-01T09:00:00Z"));
    expect(singleProbe.isForecastAvailable).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid or unsatisfiable time ranges", async () => {
    const probe = {
      isForecastAvailable: vi.fn(async () => false),
    };
    const resolver = new PeAromeRunResolver(
      probe,
      () => new Date("2026-09-01T10:00:00Z").getTime(),
      300_000,
      1,
    );

    await expect(resolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-09-01T12:00:00Z"),
      endTime: new Date("2026-09-01T11:00:00Z"),
      products,
    })).rejects.toThrow("endTime must be at or after startTime");

    await expect(resolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-09-01T10:00:00Z"),
      endTime: new Date("2026-09-03T13:00:00Z"),
      products,
    })).rejects.toThrow("extends beyond the 51-hour PE-AROME horizon");

    await expect(resolver.resolveLatestRun({
      type: "valid_time",
      validTime: new Date("2026-09-01T10:00:00Z"),
      products,
    })).rejects.toThrow("Could not find a PE-AROME run");
  });

  it("finds and caches the latest complete cycle, and reports exhaustion", async () => {
    const probe = {
      isForecastAvailable: vi.fn(async (run: Date) =>
        run.toISOString() === "2026-09-01T03:00:00.000Z"),
    };
    const resolver = new PeAromeRunResolver(
      probe,
      () => new Date("2026-09-01T10:00:00Z").getTime(),
    );

    await expect(resolver.resolveLatestCompleteRun(products))
      .resolves.toEqual(new Date("2026-09-01T03:00:00Z"));
    const calls = probe.isForecastAvailable.mock.calls.length;
    await expect(resolver.resolveLatestCompleteRun(products))
      .resolves.toEqual(new Date("2026-09-01T03:00:00Z"));
    expect(probe.isForecastAvailable).toHaveBeenCalledTimes(calls);

    const exhausted = new PeAromeRunResolver(
      { isForecastAvailable: vi.fn(async () => false) },
      () => new Date("2026-09-01T10:00:00Z").getTime(),
      300_000,
      1,
    );
    await expect(exhausted.resolveLatestCompleteRun(products))
      .rejects.toThrow("Could not find a complete PE-AROME run");
  });

  it("dispatches latest, latest_complete, and explicit selectors", async () => {
    const provider = {
      resolveLatestRun: vi.fn(async () => new Date("2026-09-01T09:00:00Z")),
      resolveLatestCompleteRun: vi.fn(async () => new Date("2026-09-01T03:00:00Z")),
    };
    const requirement = {
      type: "valid_time" as const,
      validTime: new Date("2026-09-01T12:00:00Z"),
      products,
    };

    await expect(resolvePeAromeRun("latest", requirement, provider))
      .resolves.toEqual(new Date("2026-09-01T09:00:00Z"));
    await expect(resolvePeAromeRun("latest_complete", requirement, provider))
      .resolves.toEqual(new Date("2026-09-01T03:00:00Z"));
    expect(resolvePeAromeRun(
      "2026-09-01T15:00:00.000Z",
      requirement,
      provider,
    )).toEqual(new Date("2026-09-01T15:00:00.000Z"));
  });
});
