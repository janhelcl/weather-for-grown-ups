import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IconD2EpsMemberFileFilter,
  IconD2EpsOpenDataCache,
  iconD2EpsWgrib2TagForMember,
} from "../src/cache/icon-d2-eps-open-data-cache.js";
import {
  ICON_D2_EPS_MEMBERS,
  iconD2EpsMemberOrdinal,
  sortIconD2EpsMembers,
} from "../src/catalog/icon-d2-eps.js";
import { ATMOSPHERIC_DATASET_CATALOG } from "../src/catalog/models.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../src/catalog/variables.js";
import { IconD2EpsForecastService } from "../src/core/icon-d2-eps.js";
import { IconD2EpsQueryAdapter } from "../src/core/query-adapters/icon-d2-eps.js";
import { IconD2EpsDiagnosticAdapter } from "../src/core/diagnostic-adapters/icon-d2-eps.js";
import {
  diagnoseAtmosphereSchema,
  publicDatasetCapabilities,
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";
import { buildIconD2EpsOpenDataUrl } from "../src/sources/icon-d2-eps.js";

describe("ICON-D2-EPS source and catalog", () => {
  it("preserves the native 20-member population and DWD object naming", () => {
    const run = new Date("2026-08-31T00:00:00Z");
    expect(ICON_D2_EPS_MEMBERS).toHaveLength(20);
    expect(iconD2EpsMemberOrdinal("p01")).toBe(1);
    expect(iconD2EpsMemberOrdinal("p20")).toBe(20);
    expect(sortIconD2EpsMembers(["p20", "p01", "p10"])).toEqual(["p01", "p10", "p20"]);

    expect(buildIconD2EpsOpenDataUrl(run, 6, {
      type: "pressure",
      parameter: "t",
      pressureHpa: 850,
    })).toBe(
      "https://opendata.dwd.de/weather/nwp/icon-d2-eps/grib/00/t/"
      + "icon-d2-eps_germany_icosahedral_pressure-level_2026083100_006_850_t.grib2.bz2",
    );
    expect(buildIconD2EpsOpenDataUrl(run, 6, {
      type: "single",
      parameter: "t_2m",
    })).toBe(
      "https://opendata.dwd.de/weather/nwp/icon-d2-eps/grib/00/t_2m/"
      + "icon-d2-eps_germany_icosahedral_single-level_2026083100_006_2d_t_2m.grib2.bz2",
    );
    expect(() => buildIconD2EpsOpenDataUrl(run, -1, {
      type: "single",
      parameter: "t_2m",
    })).toThrow("forecast hour must be a whole number from 0 to 48");
    expect(() => buildIconD2EpsOpenDataUrl(run, 6.5, {
      type: "single",
      parameter: "t_2m",
    })).toThrow("forecast hour must be a whole number from 0 to 48");
  });

  it("registers a limited-area 20-member physics ensemble on the native mesh", () => {
    expect(ATMOSPHERIC_DATASET_CATALOG.icon_d2_eps_2p1km).toMatchObject({
      family: "icon-d2-eps",
      provider: "dwd",
      modelClass: "physics",
      kind: "ensemble",
      role: "forecast",
      maxForecastHour: 48,
      nativeForecastIntervalHours: 1,
      members: 20,
      nativeGrid: {
        type: "icosahedral",
        nominalResolution: { value: 2.1, unit: "km" },
      },
    });
    expect(publicDatasetCapabilities("icon-d2-eps")).toMatchObject({
      dataset: "icon-d2-eps",
      kind: "ensemble",
      provider: "dwd",
      spatialDomain: { scope: "limited_area" },
      operations: expect.arrayContaining([
        "profile",
        "timeseries",
        "layer_diagnostics",
        "profile_diagnostics",
        "diagnostic_timeseries",
        "points",
        "points_timeseries",
        "transect",
        "area_summary",
        "ensemble_distribution",
      ]),
    });
  });

  it("validates member selection through the same public query language", () => {
    expect(queryAtmosphereSchema.parse({
      dataset: "icon-d2-eps",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["p01", "p20"] },
    }).ensemble?.members).toEqual(["p01", "p20"]);

    expect(() => queryAtmosphereSchema.parse({
      dataset: "icon-d2-eps",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["p01", "c00"] },
    })).toThrow("ICON-D2-EPS members are p01..p20");
  });
});

describe("ICON-D2-EPS all-member selected-object cache", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "wfg-icon-d2-eps-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("downloads one all-members object per selected variable rather than one object per member", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    const decompress = vi.fn(async () => new TextEncoder().encode("GRIB-EPS"));
    const cache = new IconD2EpsOpenDataCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      decompress,
    );
    const request = {
      run: new Date("2026-08-31T00:00:00Z"),
      forecastHour: 6,
      variables: [VARIABLE_CATALOG.temperature] as RawVariableDefinition[],
      pressureLevelsHpa: [850],
      fields: [],
    };

    const first = await cache.fetch(request);
    expect(first.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(first.path))).toBe("GRIB-EPS");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]![0])).toContain(
      "/t/icon-d2-eps_germany_icosahedral_pressure-level_2026083100_006_850_t.grib2.bz2",
    );

    const second = await cache.fetch(request);
    expect(second).toMatchObject({ path: first.path, cacheHit: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("ICON-D2-EPS native member filtering", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "wfg-icon-d2-eps-members-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("maps the provider inventory to p01..p20 and materializes one member-only GRIB", async () => {
    const inventory = Array.from({ length: 20 }, (_, index) =>
      `${index + 1}:0:d=2026083100:TMP:850 mb:6 hour fcst:ENS=+${index + 1}`
    ).join("\n");
    const runner = vi.fn(async (_executable: string, args: string[]) => {
      if (args.includes("-s")) return { stdout: inventory };
      const output = args.at(-1)!;
      await writeFile(output, new TextEncoder().encode("GRIB-MEMBER"));
      return { stdout: "selected" };
    });
    const sourcePath = join(rootDir, "all-members.grib2");
    await writeFile(sourcePath, new TextEncoder().encode("GRIB-ALL"));
    const filter = new IconD2EpsMemberFileFilter(
      join(rootDir, "filtered"),
      "wgrib2-test",
      runner,
    );

    expect(iconD2EpsWgrib2TagForMember(inventory, "p01")).toBe("ENS=+1");
    expect(iconD2EpsWgrib2TagForMember(inventory, "p20")).toBe("ENS=+20");

    const first = await filter.filter(sourcePath, "p02");
    expect(first.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(first.path))).toBe("GRIB-MEMBER");
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1]![1].join(" ")).toContain("ENS=\\+2");

    const second = await filter.filter(sourcePath, "p02");
    expect(second).toMatchObject({ path: first.path, cacheHit: true });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("rejects incomplete member inventories instead of guessing", () => {
    const inventory = Array.from({ length: 19 }, (_, index) =>
      `${index + 1}:0:d=2026083100:TMP:850 mb:6 hour fcst:ENS=+${index + 1}`
    ).join("\n");
    expect(() => iconD2EpsWgrib2TagForMember(inventory, "p01"))
      .toThrow("exposed 19 distinct forecast-member tags; expected 20");
  });

  it("surfaces the native wgrib2 dependency clearly", async () => {
    const sourcePath = join(rootDir, "all-members.grib2");
    await writeFile(sourcePath, new TextEncoder().encode("GRIB-ALL"));
    const filter = new IconD2EpsMemberFileFilter(
      join(rootDir, "filtered"),
      "missing-wgrib2",
      async () => { throw new Error("spawn missing-wgrib2 ENOENT"); },
    );
    await expect(filter.filter(sourcePath, "p01"))
      .rejects.toThrow("ICON-D2-EPS requires native wgrib2");
  });
});

describe("ICON-D2-EPS member-first aggregation", () => {
  it("runs the deterministic regional engine per member and pins one resolved run", async () => {
    const calls: Array<{ member: string; request: any }> = [];
    const service = new IconD2EpsForecastService({
      concurrency: 2,
      memberServiceFactory: (member) => ({
        query: vi.fn(async (request: any) => {
          calls.push({ member, request });
          const offset = member === "p01" ? 0 : 2;
          return {
            model: "icon_d2_0p02",
            run: "2026-08-31T00:00:00.000Z",
            validTime: "2026-08-31T06:00:00.000Z",
            forecastHour: 6,
            requestedPoint: { latitude: 50.08, longitude: 14.43 },
            gridPoint: { latitude: 50.08, longitude: 14.43 },
            levels: [{
              pressureHpa: 850,
              temperatureC: 10 + offset,
              uWindMs: 3 + offset,
              vWindMs: 4,
              windSpeedMs: 5 + offset,
              windDirectionDeg: member === "p01" ? 350 : 10,
            }],
            fields: [{
              id: "temperature_2m",
              level: { type: "height_above_ground_m", heightM: 2 },
              temporal: { type: "instantaneous" },
              values: { temperatureC: 12 + offset },
            }],
            source: {
              provider: "DWD Open Data",
              access: "dwd_open_data",
              decoder: "gribberish",
              cacheHit: true,
            },
          };
        }),
        diagnose: vi.fn(),
      } as any),
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "icon-d2-eps",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: {
        variables: ["temperature", "wind"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m"],
      },
      ensemble: {
        members: ["p01", "p02"],
        quantiles: [0.5],
        includeMembers: true,
      },
    })) as any;

    expect(result.model).toBe("icon_d2_eps_2p1km");
    expect(result.selection.members).toEqual(["p01", "p02"]);
    expect(result.pressureSummaries.find((summary: any) =>
      summary.field === "temperatureC",
    ).distribution).toMatchObject({
      memberCount: 2,
      mean: 11,
      min: 10,
      max: 12,
    });
    expect(result.fieldSummaries[0].outputs[0].distribution.mean).toBe(13);
    expect(result.source).toMatchObject({
      provider: "DWD Open Data",
      product: "icon_d2_eps_native_icosahedral",
      access: "dwd_open_data",
      nativeGrid: { type: "icosahedral", nominalResolutionKm: 2.1 },
      packaging: "all_members_grib2_bz2",
      memberCount: 2,
    });

    expect(calls[0]).toMatchObject({
      member: "p01",
      request: {
        dataset: "icon-d2",
        forecast: { run: "latest" },
      },
    });
    expect(calls[1]).toMatchObject({
      member: "p02",
      request: {
        dataset: "icon-d2",
        forecast: { run: "2026-08-31T00:00:00.000Z" },
      },
    });
  });

  it("aggregates nonlinear diagnostics only after member-level derivation", async () => {
    const service = new IconD2EpsForecastService({
      memberServiceFactory: (member) => ({
        query: vi.fn(),
        diagnose: vi.fn(async () => ({
          model: "icon_d2_0p02",
          run: "2026-08-31T00:00:00.000Z",
          validTime: "2026-08-31T06:00:00.000Z",
          forecastHour: 6,
          requestedPoint: { latitude: 50.08, longitude: 14.43 },
          gridPoint: { latitude: 50.08, longitude: 14.43 },
          layer: {
            lowerPressureHpa: 850,
            upperPressureHpa: 700,
            lowerGeopotentialHeightGpm: 1500,
            upperGeopotentialHeightGpm: member === "p01" ? 3000 : 3200,
            depthGpm: member === "p01" ? 1500 : 1700,
          },
          levels: [],
          diagnostics: [{
            id: "temperature_lapse_rate",
            values: {
              temperatureLapseRateCPerKm: member === "p01" ? 6 : 8,
            },
          }],
          source: {
            provider: "DWD Open Data",
            access: "dwd_open_data",
            decoder: "gribberish",
            cacheHit: true,
          },
        })),
      } as any),
    });

    const result = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "icon-d2-eps",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      ensemble: { members: ["p01", "p02"], quantiles: [0.5] },
    })) as any;

    expect(result.layerDepthGpm.mean).toBe(1600);
    expect(result.summaries.find((summary: any) =>
      summary.field === "temperatureLapseRateCPerKm",
    ).distribution.mean).toBe(7);
  });

  it("keeps query and diagnostic adapters injectable", async () => {
    const query = vi.fn(async () => ({ route: "icon-d2-eps-query" }));
    const diagnose = vi.fn(async () => ({ route: "icon-d2-eps-diagnose" }));
    const queryAdapter = new IconD2EpsQueryAdapter({ iconD2Eps: { query } as any });
    const diagnosticAdapter = new IconD2EpsDiagnosticAdapter({
      iconD2EpsDiagnostics: { diagnose } as any,
    });

    await expect(queryAdapter.query({} as any)).resolves.toEqual({
      route: "icon-d2-eps-query",
    });
    await expect(diagnosticAdapter.diagnose({} as any)).resolves.toEqual({
      route: "icon-d2-eps-diagnose",
    });
  });
});
