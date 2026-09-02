import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IconD2EpsMemberFileFilter,
  IconD2EpsOpenDataCache,
  iconD2EpsExactMemberMatchPattern,
  iconD2EpsWgrib2TagForMember,
} from "../src/cache/icon-d2-eps-open-data-cache.js";
import {
  IconD2EpsAdaptiveMemberSubsetCache,
  IconD2EpsMemberFileCombiner,
  iconD2EpsRequiresMemberFirstRemap,
} from "../src/cache/icon-d2-eps-member-cache.js";
import {
  ICON_D2_EPS_FIELD_IDS,
  ICON_D2_EPS_MEMBERS,
  expandIconD2EpsRequestedFields,
  iconD2EpsMemberOrdinal,
  isIconD2EpsField,
  sortIconD2EpsMembers,
} from "../src/catalog/icon-d2-eps.js";
import { ATMOSPHERIC_DATASET_CATALOG } from "../src/catalog/models.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type RawNonIsobaricFieldDefinition,
} from "../src/catalog/non-isobaric-fields.js";
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
    expect(sortIconD2EpsMembers([
      "p20",
      "unknown" as any,
      "p01",
    ])).toEqual(["p01", "p20", "unknown"]);
    expect(() => iconD2EpsMemberOrdinal("unknown" as any))
      .toThrow("Unknown ICON-D2-EPS member");
    expect(ICON_D2_EPS_FIELD_IDS).toContain("shallow_convective_cloud_base_height_msl");
    expect(ICON_D2_EPS_FIELD_IDS).toContain("shallow_convective_cloud_top_height_msl");
    expect(ICON_D2_EPS_FIELD_IDS).not.toContain("dry_convection_top_height_msl");
    expect(isIconD2EpsField("shallow_convective_cloud_base_height_msl")).toBe(true);
    expect(isIconD2EpsField("dry_convection_top_height_msl")).toBe(false);
    expect(() => expandIconD2EpsRequestedFields(["dry_convection_top_height_msl"]))
      .toThrow("ICON-D2-EPS fields not supported");

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

describe("ICON-D2-EPS source defensive branches", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "wfg-icon-d2-eps-source-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("rejects empty selections before upstream access", async () => {
    const cache = new IconD2EpsOpenDataCache(
      rootDir,
      vi.fn() as unknown as typeof fetch,
    );
    await expect(cache.fetch({
      run: new Date("2026-08-31T00:00:00Z"),
      forecastHour: 6,
      variables: [],
      pressureLevelsHpa: [],
      fields: [],
    })).rejects.toThrow("must contain at least one pressure variable or surface field");
  });

  it("maps the complete supported pressure and surface inventory", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    const cache = new IconD2EpsOpenDataCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      async () => new TextEncoder().encode("GRIB-EPS"),
    );

    await cache.fetch({
      run: new Date("2026-08-31T00:00:00Z"),
      forecastHour: 6,
      variables: [
        VARIABLE_CATALOG.temperature,
        VARIABLE_CATALOG.relative_humidity,
        VARIABLE_CATALOG.u_wind,
        VARIABLE_CATALOG.v_wind,
        VARIABLE_CATALOG.geopotential_height,
        VARIABLE_CATALOG.vertical_velocity,
      ] as RawVariableDefinition[],
      pressureLevelsHpa: [850],
      fields: [
        NON_ISOBARIC_FIELD_CATALOG.temperature_2m,
        NON_ISOBARIC_FIELD_CATALOG.u_wind_10m,
        NON_ISOBARIC_FIELD_CATALOG.v_wind_10m,
        NON_ISOBARIC_FIELD_CATALOG.wind_gust,
        NON_ISOBARIC_FIELD_CATALOG.mean_layer_cape,
        NON_ISOBARIC_FIELD_CATALOG.mean_layer_cin,
        NON_ISOBARIC_FIELD_CATALOG.updraft_helicity_max_2_8km,
        NON_ISOBARIC_FIELD_CATALOG.mean_sea_level_pressure,
        NON_ISOBARIC_FIELD_CATALOG.total_precipitation,
        NON_ISOBARIC_FIELD_CATALOG.convective_rain,
        NON_ISOBARIC_FIELD_CATALOG.convective_snow,
        NON_ISOBARIC_FIELD_CATALOG.visibility,
        NON_ISOBARIC_FIELD_CATALOG.cloud_ceiling_height_msl,
        NON_ISOBARIC_FIELD_CATALOG.shallow_convective_cloud_base_height_msl,
        NON_ISOBARIC_FIELD_CATALOG.shallow_convective_cloud_top_height_msl,
        NON_ISOBARIC_FIELD_CATALOG.column_maximum_reflectivity,
      ] as RawNonIsobaricFieldDefinition[],
    });

    expect(fetchFn).toHaveBeenCalledTimes(22);
    const urls = fetchFn.mock.calls.map((call) => String(call[0]));
    for (const parameter of [
      "/t/",
      "/relhum/",
      "/u/",
      "/v/",
      "/fi/",
      "/omega/",
      "/t_2m/",
      "/u_10m/",
      "/v_10m/",
      "/vmax_10m/",
      "/cape_ml/",
      "/cin_ml/",
      "/uh_max/",
      "/pmsl/",
      "/tot_prec/",
      "/rain_con/",
      "/snow_con/",
      "/vis/",
      "/ceiling/",
      "/hbas_sc/",
      "/htop_sc/",
      "/dbz_cmax/",
    ]) {
      expect(urls.some((url) => url.includes(parameter))).toBe(true);
    }
  });

  it("rejects unsupported pressure and surface mappings explicitly", async () => {
    const cache = new IconD2EpsOpenDataCache(
      rootDir,
      vi.fn() as unknown as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      async () => new TextEncoder().encode("GRIB-EPS"),
    );
    const base = {
      run: new Date("2026-08-31T00:00:00Z"),
      forecastHour: 6,
      pressureLevelsHpa: [850],
    };

    await expect(cache.fetch({
      ...base,
      variables: [{ id: "unsupported_pressure" } as any],
      fields: [],
    })).rejects.toThrow("no pressure-file mapping");

    await expect(cache.fetch({
      ...base,
      variables: [],
      fields: [{ id: "unsupported_field" } as any],
    })).rejects.toThrow("no single-level file mapping");
  });

  it("handles availability requirements and upstream status distinctly", async () => {
    const successfulFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const cache = new IconD2EpsOpenDataCache(
      rootDir,
      successfulFetch as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );
    const run = new Date("2026-08-31T00:00:00Z");

    await expect(cache.isForecastAvailable(
      run,
      6,
      { pressure: false, surface: false },
    )).resolves.toBe(false);
    await expect(cache.isForecastAvailable(
      run,
      6,
      { pressure: true, surface: true },
    )).resolves.toBe(true);
    expect(successfulFetch).toHaveBeenCalledTimes(2);

    const missing = new IconD2EpsOpenDataCache(
      join(rootDir, "missing"),
      vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );
    await expect(missing.isForecastAvailable(
      run,
      6,
      { pressure: true, surface: false },
    )).resolves.toBe(false);

    const denied = new IconD2EpsOpenDataCache(
      join(rootDir, "denied"),
      vi.fn(async () => new Response(null, { status: 403, statusText: "Forbidden" })) as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );
    await expect(denied.isForecastAvailable(
      run,
      6,
      { pressure: true, surface: false },
    )).rejects.toThrow("availability request failed: HTTP 403");
  });

  it("rejects bad download status and malformed decompressed objects", async () => {
    const request = {
      run: new Date("2026-08-31T00:00:00Z"),
      forecastHour: 6,
      variables: [VARIABLE_CATALOG.temperature] as RawVariableDefinition[],
      pressureLevelsHpa: [850],
      fields: [],
    };

    const failed = new IconD2EpsOpenDataCache(
      join(rootDir, "failed-download"),
      vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" })) as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );
    await expect(failed.fetch(request)).rejects.toThrow(
      "Open Data request failed: HTTP 404",
    );

    const tooShort = new IconD2EpsOpenDataCache(
      join(rootDir, "short"),
      vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      async () => new TextEncoder().encode("NO"),
    );
    await expect(tooShort.fetch(request)).rejects.toThrow(
      "decompressed object did not start with GRIB",
    );

    const wrongMagic = new IconD2EpsOpenDataCache(
      join(rootDir, "magic"),
      vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      async () => new TextEncoder().encode("XXXX"),
    );
    await expect(wrongMagic.fetch(request)).rejects.toThrow(
      "decompressed object did not start with GRIB",
    );
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
      `${index + 1}:0:d=2026083100:TMP:850 mb:6 hour fcst:ENS=? table4.6=192 pert=${index + 1}`
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

    expect(iconD2EpsWgrib2TagForMember(inventory, "p01")).toBe("ENS=? table4.6=192 pert=1");
    expect(iconD2EpsWgrib2TagForMember(inventory, "p20")).toBe("ENS=? table4.6=192 pert=20");
    const p01Pattern = iconD2EpsExactMemberMatchPattern(
      iconD2EpsWgrib2TagForMember(inventory, "p01"),
    );
    expect(p01Pattern).toBe(":ENS=\\? table4\\.6=192 pert=1:");
    const p01Regex = new RegExp(p01Pattern);
    expect(p01Regex.test(":ENS=? table4.6=192 pert=1:vt=2026083106:")).toBe(true);
    expect(p01Regex.test(":ENS=? table4.6=192 pert=10:vt=2026083106:")).toBe(false);

    const first = await filter.filter(sourcePath, "p02");
    expect(first.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(first.path))).toBe("GRIB-MEMBER");
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1]![1]).toEqual(expect.arrayContaining([
      "-match",
      ":ENS=\\? table4\\.6=192 pert=2:",
    ]));

    const second = await filter.filter(sourcePath, "p02");
    expect(second).toMatchObject({ path: first.path, cacheHit: true });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("rejects incomplete member inventories instead of guessing", () => {
    const inventory = Array.from({ length: 19 }, (_, index) =>
      `${index + 1}:0:d=2026083100:TMP:850 mb:6 hour fcst:ENS=? table4.6=192 pert=${index + 1}`
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

describe("ICON-D2-EPS adaptive member remapping", () => {
  const baseRequest = {
    run: new Date("2026-08-31T00:00:00Z"),
    forecastHour: 6,
    variables: [],
    pressureLevelsHpa: [],
  };

  it("isolates member-first reflectivity from ordinary fields in mixed requests", async () => {
    const source = {
      fetch: vi.fn(async (request: any) => ({
        path: `/raw/${request.fields.map((field: any) => field.id).join("+") || "pressure"}.grib2`,
        cacheHit: true,
      })),
      isForecastAvailable: vi.fn(async () => true),
    };
    const remapper = {
      remap: vi.fn(async (path: string) => ({
        path: `${path}.remapped`,
        cacheHit: true,
      })),
    };
    const filter = {
      filter: vi.fn(async (path: string, member: string) => ({
        path: `${path}.${member}`,
        cacheHit: true,
      })),
    };
    const combiner = {
      combine: vi.fn(async () => ({
        path: "/combined/p02.grib2",
        cacheHit: true,
      })),
    };
    const cache = new IconD2EpsAdaptiveMemberSubsetCache(
      source as any,
      remapper as any,
      filter as any,
      combiner as any,
      "p02",
    );

    const ordinary = {
      ...baseRequest,
      fields: [
        NON_ISOBARIC_FIELD_CATALOG.temperature_2m,
        NON_ISOBARIC_FIELD_CATALOG.convective_rain,
      ] as RawNonIsobaricFieldDefinition[],
    };
    expect(iconD2EpsRequiresMemberFirstRemap(ordinary)).toBe(false);
    await expect(cache.fetch(ordinary)).resolves.toMatchObject({
      path: "/raw/temperature_2m+convective_rain.grib2.remapped.p02",
      cacheHit: true,
    });
    expect(remapper.remap).toHaveBeenLastCalledWith(
      "/raw/temperature_2m+convective_rain.grib2",
    );
    expect(filter.filter).toHaveBeenLastCalledWith(
      "/raw/temperature_2m+convective_rain.grib2.remapped",
      "p02",
    );
    expect(combiner.combine).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const mixed = {
      ...baseRequest,
      fields: [
        NON_ISOBARIC_FIELD_CATALOG.temperature_2m,
        NON_ISOBARIC_FIELD_CATALOG.convective_rain,
        NON_ISOBARIC_FIELD_CATALOG.column_maximum_reflectivity,
        NON_ISOBARIC_FIELD_CATALOG.updraft_helicity_max_2_8km,
      ] as RawNonIsobaricFieldDefinition[],
    };
    expect(iconD2EpsRequiresMemberFirstRemap(mixed)).toBe(true);
    await expect(cache.fetch(mixed)).resolves.toEqual({
      path: "/combined/p02.grib2",
      cacheHit: true,
    });
    expect(source.fetch).toHaveBeenCalledTimes(2);
    expect(source.fetch.mock.calls.map(([request]: any[]) =>
      request.fields.map((field: any) => field.id))).toEqual(expect.arrayContaining([
      ["temperature_2m", "convective_rain"],
      ["column_maximum_reflectivity", "updraft_helicity_max_2_8km"],
    ]));
    expect(remapper.remap).toHaveBeenCalledWith(
      "/raw/temperature_2m+convective_rain.grib2",
    );
    expect(filter.filter).toHaveBeenCalledWith(
      "/raw/temperature_2m+convective_rain.grib2.remapped",
      "p02",
    );
    expect(filter.filter).toHaveBeenCalledWith(
      "/raw/column_maximum_reflectivity+updraft_helicity_max_2_8km.grib2",
      "p02",
    );
    expect(remapper.remap).toHaveBeenCalledWith(
      "/raw/column_maximum_reflectivity+updraft_helicity_max_2_8km.grib2.p02",
    );
    expect(combiner.combine).toHaveBeenCalledWith([
      {
        path: "/raw/temperature_2m+convective_rain.grib2.remapped.p02",
        cacheHit: true,
      },
      {
        path: "/raw/column_maximum_reflectivity+updraft_helicity_max_2_8km.grib2.p02.remapped",
        cacheHit: true,
      },
    ]);

    vi.clearAllMocks();
    const reflectivityOnly = {
      ...baseRequest,
      fields: [
        NON_ISOBARIC_FIELD_CATALOG.column_maximum_reflectivity,
      ] as RawNonIsobaricFieldDefinition[],
    };
    await expect(cache.fetch(reflectivityOnly)).resolves.toEqual({
      path: "/raw/column_maximum_reflectivity.grib2.p02.remapped",
      cacheHit: true,
    });
    expect(combiner.combine).not.toHaveBeenCalled();
  });
});

describe("ICON-D2-EPS member file combiner", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "wfg-icon-d2-eps-combined-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("combines strategy-specific member GRIBs once and preserves cache provenance", async () => {
    const first = join(rootDir, "ordinary.grib2");
    const second = join(rootDir, "reflectivity.grib2");
    await Promise.all([
      writeFile(first, new TextEncoder().encode("GRIB-ORDINARY")),
      writeFile(second, new TextEncoder().encode("GRIB-REFLECTIVITY")),
    ]);
    const combiner = new IconD2EpsMemberFileCombiner(join(rootDir, "combined"));

    const materialized = await combiner.combine([
      { path: first, cacheHit: true },
      { path: second, cacheHit: true },
    ]);
    expect(materialized.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(materialized.path)))
      .toBe("GRIB-ORDINARYGRIB-REFLECTIVITY");

    await expect(combiner.combine([
      { path: first, cacheHit: true },
      { path: second, cacheHit: true },
    ])).resolves.toEqual({
      path: materialized.path,
      cacheHit: true,
    });

    await expect(combiner.combine([
      { path: first, cacheHit: false },
      { path: second, cacheHit: true },
    ])).resolves.toEqual({
      path: materialized.path,
      cacheHit: false,
    });
    await expect(combiner.combine([{ path: first, cacheHit: true }]))
      .resolves.toEqual({ path: first, cacheHit: true });
    await expect(combiner.combine([])).rejects.toThrow(
      "requires at least one GRIB file",
    );
  });
});

describe("ICON-D2-EPS service guards and defaults", () => {
  it("rejects wrong dataset identities and unsupported parcel diagnostics before source access", async () => {
    const service = new IconD2EpsForecastService({
      memberServiceFactory: () => ({
        query: vi.fn(),
        diagnose: vi.fn(),
      }),
    });

    await expect(service.query({ dataset: "gfs" } as any))
      .rejects.toThrow("only accepts dataset=icon-d2-eps");
    await expect(service.diagnose({ dataset: "gfs" } as any))
      .rejects.toThrow("only accepts dataset=icon-d2-eps");
    await expect(service.diagnose({
      dataset: "icon-d2-eps",
      diagnostic: { kind: "parcel" },
    } as any)).rejects.toThrow("parcel diagnostics are not exposed");
  });

  it("rejects unsupported or singleton member selections", async () => {
    const service = new IconD2EpsForecastService({
      memberServiceFactory: () => ({
        query: vi.fn(),
        diagnose: vi.fn(),
      }),
    });
    const base = {
      dataset: "icon-d2-eps",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    };

    await expect(service.query({
      ...base,
      ensemble: { members: ["p01", "bogus"] },
    } as any)).rejects.toThrow("unsupported: bogus");
    await expect(service.query({
      ...base,
      ensemble: { members: ["p01"] },
    } as any)).rejects.toThrow("requires at least two selected members");
  });

  it("uses the full native population and default quantiles when ensemble modifiers are omitted", async () => {
    const service = new IconD2EpsForecastService({
      memberServiceFactory: () => ({
        query: vi.fn(async (request: any) => ({
          model: "icon_d2_0p02",
          run: "2026-08-31T00:00:00.000Z",
          validTime: "2026-08-31T06:00:00.000Z",
          forecastHour: 6,
          requestedPoint: request.geometry,
          gridPoint: { latitude: 50.08, longitude: 14.42 },
          levels: [{ pressureHpa: 850, temperatureC: 10 }],
          source: {
            provider: "DWD Open Data",
            access: "dwd_open_data",
            decoder: "wgrib2",
            cacheHit: true,
          },
        })),
        diagnose: vi.fn(),
      }),
    });

    const result = await service.query({
      dataset: "icon-d2-eps",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    } as any) as any;

    expect(result.selection.members).toEqual(ICON_D2_EPS_MEMBERS);
    expect(result.selection.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(result.pressureSummaries[0].distribution.memberCount).toBe(20);
    expect(result.members).toBeUndefined();
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
            fields: [
              {
                id: "temperature_2m",
                level: { type: "height_above_ground_m", heightM: 2 },
                temporal: { type: "instantaneous" },
                values: { temperatureC: 12 + offset },
              },
              {
                id: "updraft_helicity_max_2_8km",
                level: { type: "named_layer", id: "height_layer_2_8km_msl" },
                temporal: {
                  type: "maximum",
                  startForecastHour: 5,
                  endForecastHour: 6,
                  startTime: "2026-08-31T05:00:00.000Z",
                  endTime: "2026-08-31T06:00:00.000Z",
                },
                values: { updraftHelicityM2S2: 150 + offset * 10 },
              },
              {
                id: "visibility",
                level: { type: "surface" },
                temporal: { type: "instantaneous" },
                values: { visibilityM: 10_000 + offset * 1_000 },
              },
              {
                id: "cloud_ceiling_height_msl",
                level: { type: "named_level", id: "cloud_ceiling" },
                temporal: { type: "instantaneous" },
                values: { cloudCeilingHeightMslM: 1_500 + offset * 100 },
              },
              {
                id: "shallow_convective_cloud_base_height_msl",
                level: { type: "named_level", id: "mean_sea_level" },
                temporal: { type: "instantaneous" },
                values: { shallowConvectiveCloudBaseHeightMslM: 1_100 + offset * 100 },
              },
              {
                id: "shallow_convective_cloud_top_height_msl",
                level: { type: "named_level", id: "mean_sea_level" },
                temporal: { type: "instantaneous" },
                values: { shallowConvectiveCloudTopHeightMslM: 2_300 + offset * 100 },
              },
            ],
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
        fields: [
          "temperature_2m",
          "updraft_helicity_max_2_8km",
          "visibility",
          "cloud_ceiling_height_msl",
          "shallow_convective_cloud_base_height_msl",
          "shallow_convective_cloud_top_height_msl",
        ],
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
    expect(result.fieldSummaries.find((summary: any) => summary.field === "temperature_2m")
      .outputs[0].distribution.mean).toBe(13);
    expect(result.fieldSummaries.find(
      (summary: any) => summary.field === "updraft_helicity_max_2_8km",
    )).toMatchObject({
      level: { type: "named_layer", id: "height_layer_2_8km_msl" },
      temporal: {
        type: "maximum",
        startForecastHour: 5,
        endForecastHour: 6,
        startTime: "2026-08-31T05:00:00.000Z",
        endTime: "2026-08-31T06:00:00.000Z",
      },
      outputs: [expect.objectContaining({
        field: "updraftHelicityM2S2",
        distribution: expect.objectContaining({ mean: 160 }),
      })],
    });
    expect(result.fieldSummaries.find((summary: any) => summary.field === "visibility"))
      .toMatchObject({
        level: { type: "surface" },
        temporal: { type: "instantaneous" },
        outputs: [expect.objectContaining({
          field: "visibilityM",
          distribution: expect.objectContaining({ mean: 11_000 }),
        })],
      });
    expect(result.fieldSummaries.find((summary: any) => summary.field === "cloud_ceiling_height_msl"))
      .toMatchObject({
        level: { type: "named_level", id: "cloud_ceiling" },
        temporal: { type: "instantaneous" },
        outputs: [expect.objectContaining({
          field: "cloudCeilingHeightMslM",
          distribution: expect.objectContaining({ mean: 1_600 }),
        })],
      });
    expect(result.fieldSummaries.find(
      (summary: any) => summary.field === "shallow_convective_cloud_base_height_msl",
    )).toMatchObject({
      level: { type: "named_level", id: "mean_sea_level" },
      temporal: { type: "instantaneous" },
      outputs: [expect.objectContaining({
        field: "shallowConvectiveCloudBaseHeightMslM",
        distribution: expect.objectContaining({ mean: 1_200 }),
      })],
    });
    expect(result.fieldSummaries.find(
      (summary: any) => summary.field === "shallow_convective_cloud_top_height_msl",
    )).toMatchObject({
      level: { type: "named_level", id: "mean_sea_level" },
      temporal: { type: "instantaneous" },
      outputs: [expect.objectContaining({
        field: "shallowConvectiveCloudTopHeightMslM",
        distribution: expect.objectContaining({ mean: 2_400 }),
      })],
    });
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
