import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IconD2OpenDataCache,
  bunzip2,
} from "../src/cache/icon-d2-open-data-cache.js";
import {
  expandIconD2RequestedFields,
  expandIconD2RequestedVariables,
  isIconD2Field,
  isIconD2PressureLevel,
  isIconD2PressureVariable,
} from "../src/catalog/icon-d2.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type RawNonIsobaricFieldDefinition,
} from "../src/catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../src/catalog/variables.js";
import { searchAtmosphereCatalog } from "../src/catalog/unified-search.js";
import {
  IconD2ForecastService,
  isIconD2RawAreaField,
  isIconD2RawAreaVariable,
} from "../src/core/icon-d2.js";
import { IconD2RunResolver } from "../src/core/icon-d2-run.js";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import {
  publicDatasetCoversGeometry,
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";
import {
  buildIconD2OpenDataUrl,
  floorToIconD2Cycle,
  iconD2ForecastHour,
  iconD2NativeForecastHoursInRange,
  iconD2ValidTime,
  parseIconD2Run,
} from "../src/sources/icon-d2.js";

describe("ICON-D2 Open Data naming and cadence", () => {
  const run = new Date("2026-08-31T00:00:00Z");

  it("builds exact pressure and single-level DWD object names", () => {
    expect(buildIconD2OpenDataUrl(run, 6, {
      type: "pressure",
      parameter: "t",
      pressureHpa: 850,
    })).toBe(
      "https://opendata.dwd.de/weather/nwp/icon-d2/grib/00/t/"
      + "icon-d2_germany_regular-lat-lon_pressure-level_2026083100_006_850_t.grib2.bz2",
    );
    expect(buildIconD2OpenDataUrl(run, 6, {
      type: "single",
      parameter: "t_2m",
    })).toBe(
      "https://opendata.dwd.de/weather/nwp/icon-d2/grib/00/t_2m/"
      + "icon-d2_germany_regular-lat-lon_single-level_2026083100_006_2d_t_2m.grib2.bz2",
    );
  });

  it("keeps 3-hourly cycles, hourly outputs, and the 48-hour horizon explicit", () => {
    expect(parseIconD2Run("2026-08-31T03:00:00Z").toISOString())
      .toBe("2026-08-31T03:00:00.000Z");
    expect(() => parseIconD2Run("2026-08-31T01:00:00Z")).toThrow("3-hourly UTC cycle");
    expect(iconD2ForecastHour(run, new Date("2026-08-31T06:00:00Z"))).toBe(6);
    expect(iconD2NativeForecastHoursInRange(
      run,
      new Date("2026-08-31T00:00:00Z"),
      new Date("2026-08-31T03:00:00Z"),
    )).toEqual([0, 1, 2, 3]);
    expect(iconD2ValidTime(run, 48).toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(() => iconD2ValidTime(run, 49)).toThrow("0 to 48");
    expect(floorToIconD2Cycle(new Date("2026-08-31T08:59:59Z")).toISOString())
      .toBe("2026-08-31T06:00:00.000Z");
  });
});

describe("ICON-D2 selected-object cache", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "wfg-icon-d2-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("downloads only selected DWD parameter objects, decodes bz2, combines GRIB records, and caches", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const marker = url.includes("/u/") ? 2 : 1;
      return new Response(new Uint8Array([marker]), { status: 200 });
    });
    const decompress = vi.fn(async (bytes: Uint8Array) =>
      new TextEncoder().encode(bytes[0] === 2 ? "GRIB-U" : "GRIB-T"));
    const accessPolicy = {
      run: <T>(operation: () => Promise<T>) => operation(),
    };
    const cache = new IconD2OpenDataCache(
      rootDir,
      fetchFn as typeof fetch,
      accessPolicy,
      decompress,
    );
    const request = {
      run: new Date("2026-08-31T00:00:00Z"),
      forecastHour: 6,
      variables: [
        VARIABLE_CATALOG.temperature,
        VARIABLE_CATALOG.u_wind,
      ] as RawVariableDefinition[],
      pressureLevelsHpa: [850],
      fields: [],
    };

    const first = await cache.fetch(request);
    expect(first.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(first.path))).toBe("GRIB-TGRIB-U");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.map(([input]) => String(input))).toEqual([
      expect.stringContaining("/t/icon-d2_germany_regular-lat-lon_pressure-level_2026083100_006_850_t.grib2.bz2"),
      expect.stringContaining("/u/icon-d2_germany_regular-lat-lon_pressure-level_2026083100_006_850_u.grib2.bz2"),
    ]);

    const second = await cache.fetch(request);
    expect(second).toMatchObject({ path: first.path, cacheHit: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(decompress).toHaveBeenCalledTimes(2);
  });

  it("maps visibility and aviation ceiling to their native DWD parameter objects", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    const cache = new IconD2OpenDataCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      async () => new TextEncoder().encode("GRIB-AVIATION"),
    );

    await cache.fetch({
      run: new Date("2026-08-31T00:00:00Z"),
      forecastHour: 6,
      variables: [],
      pressureLevelsHpa: [],
      fields: [
        NON_ISOBARIC_FIELD_CATALOG.visibility,
        NON_ISOBARIC_FIELD_CATALOG.cloud_ceiling_height_msl,
      ] as RawNonIsobaricFieldDefinition[],
    });

    const urls = fetchFn.mock.calls.map(([input]) => String(input));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/vis/");
    expect(urls[0]).toContain("_006_2d_vis.grib2.bz2");
    expect(urls[1]).toContain("/ceiling/");
    expect(urls[1]).toContain("_006_2d_ceiling.grib2.bz2");
  });

  it("maps convective cloud heights to their native DWD parameter objects", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    const cache = new IconD2OpenDataCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      async () => new TextEncoder().encode("GRIB-CLOUD-HEIGHT"),
    );

    await cache.fetch({
      run: new Date("2026-08-31T00:00:00Z"),
      forecastHour: 6,
      variables: [],
      pressureLevelsHpa: [],
      fields: [
        NON_ISOBARIC_FIELD_CATALOG.shallow_convective_cloud_base_height_msl,
        NON_ISOBARIC_FIELD_CATALOG.shallow_convective_cloud_top_height_msl,
        NON_ISOBARIC_FIELD_CATALOG.dry_convection_top_height_msl,
      ] as RawNonIsobaricFieldDefinition[],
    });

    const urls = fetchFn.mock.calls.map(([input]) => String(input));
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("/hbas_sc/");
    expect(urls[1]).toContain("/htop_sc/");
    expect(urls[2]).toContain("/htop_dc/");
  });

  it("maps convective rain and snow to their native DWD parameter objects", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    const cache = new IconD2OpenDataCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      async () => new TextEncoder().encode("GRIB-PRECIP"),
    );

    await cache.fetch({
      run: new Date("2026-08-31T00:00:00Z"),
      forecastHour: 6,
      variables: [],
      pressureLevelsHpa: [],
      fields: [
        NON_ISOBARIC_FIELD_CATALOG.convective_rain,
        NON_ISOBARIC_FIELD_CATALOG.convective_snow,
      ] as RawNonIsobaricFieldDefinition[],
    });

    const urls = fetchFn.mock.calls.map(([input]) => String(input));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/rain_con/");
    expect(urls[0]).toContain("_006_2d_rain_con.grib2.bz2");
    expect(urls[1]).toContain("/snow_con/");
    expect(urls[1]).toContain("_006_2d_snow_con.grib2.bz2");
  });

  it("uses HEAD probes for products required by latest-run resolution", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const cache = new IconD2OpenDataCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      async (bytes) => bytes,
    );

    expect(await cache.isForecastAvailable(
      new Date("2026-08-31T00:00:00Z"),
      6,
      { pressure: true, surface: true },
    )).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.every(([, init]) => init?.method === "HEAD")).toBe(true);
  });

  it("bundles a pure-JavaScript bzip2 decoder", async () => {
    const compressed = Uint8Array.from([
      66, 90, 104, 57, 49, 65, 89, 38, 83, 89, 193, 192, 128, 226,
      0, 0, 1, 65, 0, 0, 16, 2, 68, 160, 0, 48, 205, 0, 195,
      70, 41, 151, 23, 114, 69, 56, 80, 144, 193, 192, 128, 226,
    ]);
    expect(new TextDecoder().decode(await bunzip2(compressed))).toBe("hello\n");
  });
});

describe("ICON-D2 unified capabilities", () => {
  it("uses the same public query vocabulary while enforcing the regional inventory", () => {
    expect(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature", "wind"], pressureLevelsHpa: [850] },
      forecast: { run: "2026-08-31T00:00:00Z" },
    }).dataset).toBe("icon-d2");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["specific_humidity"], pressureLevelsHpa: [850] },
    })).toThrow("ICON-D2 pressure variables not supported");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [250] },
    })).toThrow("ICON-D2 pressure levels not supported");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 14,
        southLatitude: 49,
        northLatitude: 50,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["wind"], pressureLevelsHpa: [850] },
    })).toThrow("ICON-D2 area summaries require a native scalar pressure variable");
  });

  it("advertises limited coverage, native mesh, and access grid separately", () => {
    expect(publicDatasetCoversGeometry("icon-d2", {
      type: "point",
      latitude: 50.08,
      longitude: 14.43,
    })).toBe(true);
    expect(publicDatasetCoversGeometry("icon-d2", {
      type: "point",
      latitude: 40.42,
      longitude: -3.70,
    })).toBe(false);

    const result = searchAtmosphereCatalog({
      datasets: ["icon-d2"],
      search: "temperature",
      sections: ["variables"],
    });
    expect(result.datasetCapabilities[0]).toMatchObject({
      provider: "dwd",
      spatialDomain: { scope: "limited_area" },
      horizontalGridDegrees: 0.02,
      nativeGrid: {
        type: "icosahedral",
        nominalResolution: { value: 2.1, unit: "km" },
      },
      maxForecastHour: 48,
    });
    expect(result.matches.some((match) =>
      match.id === "temperature"
      && match.support.some((support) => support.dataset === "icon-d2"))).toBe(true);

    const gust = searchAtmosphereCatalog({
      datasets: ["icon-d2"],
      search: "gust",
      sections: ["fields"],
    });
    expect(gust.matches.find((match) => match.id === "wind_gust")).toMatchObject({
      id: "wind_gust",
      verticalSemantics: "10 m above ground",
      temporalSemantics: "maximum",
      support: [{ dataset: "icon-d2" }],
    });

    const reflectivity = searchAtmosphereCatalog({
      datasets: ["icon-d2"],
      search: "reflectivity",
      sections: ["fields"],
    });
    expect(reflectivity.matches.find(
      (match) => match.id === "column_maximum_reflectivity",
    )).toMatchObject({
      id: "column_maximum_reflectivity",
      verticalSemantics: "entire atmosphere",
      temporalSemantics: "instantaneous",
      support: [{ dataset: "icon-d2" }],
    });

    const convectivePrecipitation = searchAtmosphereCatalog({
      datasets: ["icon-d2"],
      search: "convective",
      sections: ["fields"],
    });
    const visibility = searchAtmosphereCatalog({
      datasets: ["icon-d2"],
      search: "visibility",
      sections: ["fields"],
    });
    expect(visibility.matches.find((match) => match.id === "visibility")).toMatchObject({
      id: "visibility",
      verticalSemantics: "surface",
      temporalSemantics: "instantaneous",
      outputs: [expect.objectContaining({ field: "visibilityM", unit: "m" })],
    });

    const ceiling = searchAtmosphereCatalog({
      datasets: ["icon-d2"],
      search: "ceiling",
      sections: ["fields"],
    });
    expect(ceiling.matches.find((match) => match.id === "cloud_ceiling_height_msl")).toMatchObject({
      id: "cloud_ceiling_height_msl",
      verticalSemantics: "cloud ceiling",
      temporalSemantics: "instantaneous",
      outputs: [expect.objectContaining({ field: "cloudCeilingHeightMslM", unit: "m" })],
    });

    const cloudStructure = searchAtmosphereCatalog({
      datasets: ["icon-d2"],
      search: "convection",
      sections: ["fields"],
    });
    expect(cloudStructure.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "shallow_convective_cloud_base_height_msl",
        verticalSemantics: "mean sea level",
        temporalSemantics: "instantaneous",
        outputs: [expect.objectContaining({
          field: "shallowConvectiveCloudBaseHeightMslM",
          unit: "m",
        })],
      }),
      expect.objectContaining({
        id: "shallow_convective_cloud_top_height_msl",
        verticalSemantics: "mean sea level",
        temporalSemantics: "instantaneous",
      }),
      expect.objectContaining({
        id: "dry_convection_top_height_msl",
        verticalSemantics: "mean sea level",
        temporalSemantics: "instantaneous",
      }),
    ]));

    expect(convectivePrecipitation.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "convective_rain",
        verticalSemantics: "surface",
        temporalSemantics: "accumulation",
        support: expect.arrayContaining([
          expect.objectContaining({ dataset: "icon-d2" }),
        ]),
      }),
      expect.objectContaining({
        id: "convective_snow",
        verticalSemantics: "surface",
        temporalSemantics: "accumulation",
        support: expect.arrayContaining([
          expect.objectContaining({ dataset: "icon-d2" }),
        ]),
      }),
    ]));
  });

  it("rejects out-of-domain queries before touching the ICON-D2 adapter", async () => {
    const iconD2 = { query: vi.fn(async () => ({ route: "icon-d2" })) };
    const service = new UnifiedAtmosphereQueryService({
      adapters: { "icon-d2": iconD2 },
    });

    await expect(service.query({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 40.42, longitude: -3.70 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "2026-08-31T00:00:00Z" },
    })).rejects.toThrow(/outside|domain|coverage/i);
    expect(iconD2.query).not.toHaveBeenCalled();
  });
});

describe("ICON-D2 deterministic service operations", () => {
  const run = new Date("2026-08-31T00:00:00Z");
  const runProvider = {
    resolveLatestRun: vi.fn(async () => run),
    resolveLatestCompleteRun: vi.fn(async () => run),
  };
  const cache = {
    fetch: vi.fn(async () => ({ path: "/tmp/icon-d2-test.grib2", cacheHit: false })),
    isForecastAvailable: vi.fn(async () => true),
  };
  const decoder = {
    engine: "gribberish" as const,
    extractPoint: vi.fn(async (_path: string, longitude: number, latitude: number) =>
      fakeDecodedValues(longitude, latitude)),
  };
  const areaDecoder = {
    engine: "gribberish" as const,
    summarizeBox: vi.fn(async () => ({
      totalGridPoints: 9,
      undefinedGridPoints: 0,
      definedGridPoints: 9,
      mean: 280,
      min: 278,
      max: 282,
    })),
    summarizeSelectedMessage: vi.fn(async (_path: string, _box: unknown, selector: any) => ({
      totalGridPoints: 9,
      undefinedGridPoints: 0,
      definedGridPoints: 9,
      mean: selector.code === "TMP" ? 280 : 101_325,
      min: selector.code === "TMP" ? 278 : 101_000,
      max: selector.code === "TMP" ? 282 : 101_700,
      temporal: selector.temporalSemantics === "accumulation"
        ? { type: "accumulation" as const, startForecastHour: 0, endForecastHour: 6 }
        : selector.temporalSemantics === "maximum"
          ? { type: "maximum" as const, startForecastHour: 5, endForecastHour: 6 }
          : { type: "instantaneous" as const },
    })),
  };
  const areaGridDecoder = {
    engine: "gribberish" as const,
    extractBox: vi.fn(async () => [
      { longitude: 13, latitude: 49, value: 278 },
      { longitude: 13.1, latitude: 49.1, value: 280 },
      { longitude: 13.2, latitude: 49.2, value: 282 },
    ]),
    extractSelectedMessage: vi.fn(async (_path: string, _box: unknown, selector: any) => ({
      points: [
        { longitude: 13, latitude: 49, value: selector.code === "TMP" ? 278 : 101_000 },
        { longitude: 13.1, latitude: 49.1, value: selector.code === "TMP" ? 280 : 101_325 },
        { longitude: 13.2, latitude: 49.2, value: selector.code === "TMP" ? 282 : 101_700 },
      ],
      temporal: selector.temporalSemantics === "accumulation"
        ? { type: "accumulation" as const, startForecastHour: 0, endForecastHour: 6 }
        : selector.temporalSemantics === "maximum"
          ? { type: "maximum" as const, startForecastHour: 5, endForecastHour: 6 }
          : { type: "instantaneous" as const },
    })),
  };
  const service = () => new IconD2ForecastService({
    cache,
    decoder,
    runProvider,
    areaDecoder: areaDecoder as any,
    areaGridDecoder: areaGridDecoder as any,
  });

  beforeEach(() => vi.clearAllMocks());

  it("supports point and hourly range profiles with shared derived variables", async () => {
    const point = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature", "wind"], pressureLevelsHpa: [850] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(point.model).toBe("icon_d2_0p02");
    expect(point.forecastHour).toBe(6);
    expect(point.levels[0].temperatureC).toBeCloseTo(6.85, 8);
    expect(point.levels[0].windSpeedMs).toBe(5);
    expect(point.source).toMatchObject({
      provider: "DWD Open Data",
      access: "dwd_open_data",
      productGrid: {
        type: "regular_latlon",
        resolutionDegrees: 0.02,
        interpolation: "dwd_open_data",
      },
    });

    const range = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2026-08-31T06:00:00Z",
        to: "2026-08-31T08:00:00Z",
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(range.series.map((step: any) => step.forecastHour)).toEqual([6, 7, 8]);
    expect(range.source.productGrid.resolutionDegrees).toBe(0.02);
  });

  it("reuses one selected-object file for multi-point and transect decoding", async () => {
    const points = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(points.points).toHaveLength(2);
    expect(cache.fetch).toHaveBeenCalledTimes(1);
    expect(decoder.extractPoint).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    const transect = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "transect",
        start: { latitude: 49.5, longitude: 13.5 },
        end: { latitude: 50.5, longitude: 15 },
        samples: 3,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(transect.samples).toHaveLength(3);
    expect(transect.totalDistanceKm).toBeGreaterThan(0);
    expect(cache.fetch).toHaveBeenCalledTimes(1);
    expect(decoder.extractPoint).toHaveBeenCalledTimes(3);
  });

  it("supports bounded-area scalar summaries", async () => {
    const area = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 13.2,
        southLatitude: 49,
        northLatitude: 49.2,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(area.statistics.mean).toBeCloseTo(6.85, 8);
    expect(area.variable).toMatchObject({ id: "temperature", pressureHpa: 850, unit: "degC" });
    expect(area.source.productGrid.resolutionDegrees).toBe(0.02);
  });

  it("covers bounded-area field statistics and accumulation semantics", async () => {
    const mslp = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 13.2,
        southLatitude: 49,
        northLatitude: 49.2,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { fields: ["mean_sea_level_pressure"] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(mslp.field).toMatchObject({
      id: "mean_sea_level_pressure",
      level: { type: "named_level", id: "mean_sea_level" },
      temporal: { type: "instantaneous" },
    });
    expect(mslp.statistics.mean).toBe(101_325);

    const precipitation = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 13.2,
        southLatitude: 49,
        northLatitude: 49.2,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { fields: ["total_precipitation"] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(precipitation.field.level).toEqual({ type: "surface" });
    expect(precipitation.field.temporal).toMatchObject({
      type: "accumulation",
      startForecastHour: 0,
      endForecastHour: 6,
      startTime: "2026-08-31T00:00:00.000Z",
      endTime: "2026-08-31T06:00:00.000Z",
    });

    const convectiveRain = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 13.2,
        southLatitude: 49,
        northLatitude: 49.2,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { fields: ["convective_rain"] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(convectiveRain.field).toMatchObject({
      id: "convective_rain",
      level: { type: "surface" },
      temporal: {
        type: "accumulation",
        startForecastHour: 0,
        endForecastHour: 6,
      },
    });
  });

  it("covers bounded-area pressure and field distributions", async () => {
    const pressure = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 13.2,
        southLatitude: 49,
        northLatitude: 49.2,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      aggregate: {
        percentiles: [50],
        thresholds: [{ operator: "gte", value: 6 }],
        includeExtremaLocations: true,
      },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(pressure.statistics.mean).toBeCloseTo(6.85, 8);
    expect(pressure.distribution.percentiles[0].value).toBeCloseTo(6.85, 8);
    expect(pressure.distribution.extrema.min.gridPoint).toEqual({ latitude: 49, longitude: 13 });

    const field = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 13.2,
        southLatitude: 49,
        northLatitude: 49.2,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      aggregate: {
        percentiles: [50],
        thresholds: [{ operator: "gte", value: 6 }],
        includeExtremaLocations: true,
      },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(field.field.id).toBe("temperature_2m");
    expect(field.statistics.mean).toBeCloseTo(6.85, 8);
    expect(field.distribution.percentiles[0].value).toBeCloseTo(6.85, 8);

    const extremaOnly = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 13.2,
        southLatitude: 49,
        northLatitude: 49.2,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      aggregate: { includeExtremaLocations: true },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(extremaOnly.distribution.extrema.max.gridPoint).toEqual({
      latitude: 49.2,
      longitude: 13.2,
    });
  });

  it("derives layer diagnostics through the shared diagnostic machinery", async () => {
    const diagnostic = await service().diagnose({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 1000,
        upperPressureHpa: 850,
        diagnostics: ["temperature_lapse_rate", "wind_shear"],
      },
      forecast: { run: run.toISOString() },
    } as any) as any;
    expect(diagnostic.layer.depthGpm).toBeGreaterThan(0);
    expect(diagnostic.diagnostics.map((item: any) => item.id)).toEqual([
      "temperature_lapse_rate",
      "wind_shear",
    ]);
  });


  it("covers point fields, derived 10 m wind, and field-preserving ranges", async () => {
    const point = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: [
          "temperature_2m",
          "wind_10m",
          "wind_gust",
          "mean_sea_level_pressure",
          "convective_rain",
          "convective_snow",
          "visibility",
          "cloud_ceiling_height_msl",
          "shallow_convective_cloud_base_height_msl",
          "shallow_convective_cloud_top_height_msl",
          "dry_convection_top_height_msl",
          "column_maximum_reflectivity",
        ],
      },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(point.fields.map((field: any) => field.id)).toEqual([
      "temperature_2m",
      "wind_10m",
      "wind_gust",
      "mean_sea_level_pressure",
      "convective_rain",
      "convective_snow",
      "visibility",
      "cloud_ceiling_height_msl",
      "shallow_convective_cloud_base_height_msl",
      "shallow_convective_cloud_top_height_msl",
      "dry_convection_top_height_msl",
      "column_maximum_reflectivity",
    ]);
    expect(point.fields.find((field: any) => field.id === "wind_10m")?.values.windSpeedMs).toBe(5);
    expect(point.fields.find((field: any) => field.id === "convective_rain"))
      .toMatchObject({
        level: { type: "surface" },
        temporal: {
          type: "accumulation",
          startForecastHour: 0,
          endForecastHour: 6,
          startTime: "2026-08-31T00:00:00.000Z",
          endTime: "2026-08-31T06:00:00.000Z",
        },
        values: { convectiveRainMm: 0.8 },
      });
    expect(point.fields.find((field: any) => field.id === "convective_snow"))
      .toMatchObject({
        level: { type: "surface" },
        temporal: {
          type: "accumulation",
          startForecastHour: 0,
          endForecastHour: 6,
        },
        values: { convectiveSnowWaterEquivalentMm: 0.2 },
      });
    expect(point.fields.find((field: any) => field.id === "visibility"))
      .toMatchObject({
        level: { type: "surface" },
        temporal: { type: "instantaneous" },
        values: { visibilityM: 12_000 },
      });
    expect(point.fields.find((field: any) => field.id === "cloud_ceiling_height_msl"))
      .toMatchObject({
        level: { type: "named_level", id: "cloud_ceiling" },
        temporal: { type: "instantaneous" },
        values: { cloudCeilingHeightMslM: 1_800 },
      });
    expect(point.fields.find((field: any) => field.id === "shallow_convective_cloud_base_height_msl"))
      .toMatchObject({
        level: { type: "named_level", id: "mean_sea_level" },
        temporal: { type: "instantaneous" },
        values: { shallowConvectiveCloudBaseHeightMslM: 1_200 },
      });
    expect(point.fields.find((field: any) => field.id === "shallow_convective_cloud_top_height_msl"))
      .toMatchObject({
        level: { type: "named_level", id: "mean_sea_level" },
        temporal: { type: "instantaneous" },
        values: { shallowConvectiveCloudTopHeightMslM: 2_400 },
      });
    expect(point.fields.find((field: any) => field.id === "dry_convection_top_height_msl"))
      .toMatchObject({
        level: { type: "named_level", id: "mean_sea_level" },
        temporal: { type: "instantaneous" },
        values: { dryConvectionTopHeightMslM: 1_800 },
      });
    expect(point.fields.find((field: any) => field.id === "column_maximum_reflectivity"))
      .toMatchObject({
        level: { type: "named_layer", id: "entire_atmosphere" },
        temporal: { type: "instantaneous" },
        values: { columnMaximumReflectivityFactorMm6M3: 1000 },
      });
    expect(point.fields.find((field: any) => field.id === "wind_gust")).toMatchObject({
      level: { type: "height_above_ground_m", heightM: 10 },
      temporal: {
        type: "maximum",
        startForecastHour: 5,
        endForecastHour: 6,
        startTime: "2026-08-31T05:00:00.000Z",
        endTime: "2026-08-31T06:00:00.000Z",
      },
      values: { windGustMs: 18 },
    });

    const range = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2026-08-31T06:00:00Z",
        to: "2026-08-31T07:00:00Z",
      },
      selection: { fields: ["temperature_2m"] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(range.series).toHaveLength(2);
    expect(range.series.every((step: any) => step.fields[0].id === "temperature_2m")).toBe(true);
  });

  it("covers multi-point ranges and default transect sampling", async () => {
    const pointsRange = await service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: {
        from: "2026-08-31T06:00:00Z",
        to: "2026-08-31T07:00:00Z",
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(pointsRange.series).toHaveLength(2);
    expect(pointsRange.series.every((step: any) => step.points.length === 2)).toBe(true);

    const fallbackDecoder = {
      extractPoint: vi.fn(async (_path: string, longitude: number, latitude: number) =>
        fakeDecodedValues(longitude, latitude)),
    };
    const fallback = new IconD2ForecastService({
      cache: {
        fetch: vi.fn(async () => ({ path: "/tmp/icon-d2-test.grib2", cacheHit: true })),
        isForecastAvailable: vi.fn(async () => true),
      },
      decoder: fallbackDecoder,
      runProvider,
      areaDecoder: areaDecoder as any,
    });
    const transect = await fallback.query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "transect",
        start: { latitude: 49.5, longitude: 13.5 },
        end: { latitude: 50.5, longitude: 15 },
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(transect.samples).toHaveLength(21);
    expect(transect.source).toMatchObject({ decoder: "gribberish", cacheHit: true });
  });

  it("covers profile and ranged diagnostics", async () => {
    const profile = await service().diagnose({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
        diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      },
      forecast: { run: run.toISOString() },
    } as any) as any;
    expect(profile.sampledPressureLevelsHpa).toEqual([1000, 925, 850, 700, 500]);
    expect(profile.diagnostics).toHaveLength(2);

    const range = await service().diagnose({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2026-08-31T06:00:00Z",
        to: "2026-08-31T07:00:00Z",
      },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      forecast: { run: run.toISOString() },
    } as any) as any;
    expect(range.series.map((step: any) => step.forecastHour)).toEqual([6, 7]);
    expect(range.series.every((step: any) => step.kind === "layer")).toBe(true);
  });

  it("keeps direct service guardrails explicit below the public schema", async () => {
    const instance = service();
    await expect(instance.query({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    } as any)).rejects.toThrow("only accepts dataset=icon-d2");

    await expect(instance.diagnose({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T06:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
    } as any)).rejects.toThrow("only accepts dataset=icon-d2");

    await expect(instance.diagnose({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T06:00:00Z" },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850],
        parcel: "surface_2m",
      },
    } as any)).rejects.toThrow("does not expose parcel diagnostics");
  });

  it("enforces native-step, multi-point and area resource limits", async () => {
    await expect(service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: {
        from: "2026-08-31T06:00:00Z",
        to: "2026-08-31T08:00:00Z",
        maxSteps: 2,
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: run.toISOString() },
    }))).rejects.toThrow("exceeding maxSteps=2");

    await expect(service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "points",
        points: [
          { latitude: 50, longitude: 14 },
          { latitude: 51, longitude: 15 },
        ],
      },
      time: {
        from: "2026-08-31T06:00:00Z",
        to: "2026-08-31T08:00:00Z",
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      limits: { maxPointSteps: 5 },
      forecast: { run: run.toISOString() },
    }))).rejects.toThrow("exceeding maxPointSteps=5");

    await expect(service().query(queryAtmosphereSchema.parse({
      dataset: "icon-d2",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 13.2,
        southLatitude: 49,
        northLatitude: 49.2,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      limits: { maxGridPoints: 10 },
      forecast: { run: run.toISOString() },
    }))).rejects.toThrow("exceeding maxGridPoints=10");
  });

});

describe("ICON-D2 run resolution", () => {
  it("walks back 3-hourly cycles and probes the requested hourly lead", async () => {
    const available = new Date("2026-08-31T06:00:00Z");
    const probe = {
      isForecastAvailable: vi.fn(async (candidate: Date, forecastHour: number) =>
        candidate.getTime() === available.getTime() && forecastHour === 2),
    };
    const resolver = new IconD2RunResolver(
      probe,
      () => new Date("2026-08-31T09:30:00Z").getTime(),
      60_000,
      4,
    );
    expect(await resolver.resolveLatestRun({
      type: "valid_time",
      validTime: new Date("2026-08-31T08:00:00Z"),
      products: { pressure: true, surface: false },
    })).toEqual(available);
    expect(probe.isForecastAvailable).toHaveBeenCalledWith(
      available,
      2,
      { pressure: true, surface: false },
    );
  });


  it("checks latest-complete horizon probes and range endpoints", async () => {
    const completeRun = new Date("2026-08-31T06:00:00Z");
    const completeProbe = {
      isForecastAvailable: vi.fn(async (candidate: Date, forecastHour: number) =>
        candidate.getTime() === completeRun.getTime() && forecastHour === 48),
    };
    const completeResolver = new IconD2RunResolver(
      completeProbe,
      () => new Date("2026-08-31T09:30:00Z").getTime(),
      60_000,
      3,
    );
    expect(await completeResolver.resolveLatestCompleteRun({
      pressure: true,
      surface: true,
    })).toEqual(completeRun);
    expect(completeProbe.isForecastAvailable).toHaveBeenCalledWith(
      completeRun,
      48,
      { pressure: true, surface: true },
    );

    const rangeRun = new Date("2026-08-31T06:00:00Z");
    const rangeProbe = {
      isForecastAvailable: vi.fn(async (candidate: Date, forecastHour: number) =>
        candidate.getTime() === rangeRun.getTime() && [2, 4].includes(forecastHour)),
    };
    const rangeResolver = new IconD2RunResolver(
      rangeProbe,
      () => new Date("2026-08-31T09:30:00Z").getTime(),
      60_000,
      2,
    );
    expect(await rangeResolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-08-31T08:00:00Z"),
      endTime: new Date("2026-08-31T10:00:00Z"),
      products: { pressure: true, surface: false },
    })).toEqual(rangeRun);
    expect(rangeProbe.isForecastAvailable).toHaveBeenCalledWith(
      rangeRun,
      2,
      { pressure: true, surface: false },
    );
    expect(rangeProbe.isForecastAvailable).toHaveBeenCalledWith(
      rangeRun,
      4,
      { pressure: true, surface: false },
    );
  });

  it("fails clearly when no eligible run is published", async () => {
    const probe = { isForecastAvailable: vi.fn(async () => false) };
    const resolver = new IconD2RunResolver(
      probe,
      () => new Date("2026-08-31T12:00:00Z").getTime(),
      60_000,
      2,
    );
    await expect(resolver.resolveLatestRun({
      type: "valid_time",
      validTime: new Date("2026-08-31T12:00:00Z"),
      products: { pressure: true, surface: false },
    })).rejects.toThrow("Could not find an ICON-D2 run");
    await expect(resolver.resolveLatestCompleteRun({
      pressure: true,
      surface: false,
    })).rejects.toThrow("Could not find a complete ICON-D2 run");
  });

});


describe("ICON-D2 guard and inventory branches", () => {
  it("keeps raw-area capability predicates truthful", () => {
    expect(isIconD2RawAreaVariable("temperature")).toBe(true);
    expect(isIconD2RawAreaVariable("wind")).toBe(false);
    expect(isIconD2RawAreaVariable("not-a-variable")).toBe(false);
    expect(isIconD2RawAreaField("temperature_2m")).toBe(true);
    expect(isIconD2RawAreaField("convective_rain")).toBe(true);
    expect(isIconD2RawAreaField("convective_snow")).toBe(true);
    expect(isIconD2RawAreaField("visibility")).toBe(true);
    expect(isIconD2RawAreaField("cloud_ceiling_height_msl")).toBe(false);
    expect(isIconD2RawAreaField("shallow_convective_cloud_base_height_msl")).toBe(false);
    expect(isIconD2RawAreaField("shallow_convective_cloud_top_height_msl")).toBe(false);
    expect(isIconD2RawAreaField("dry_convection_top_height_msl")).toBe(false);
    expect(isIconD2RawAreaField("wind_10m")).toBe(false);
    expect(isIconD2RawAreaField("column_maximum_reflectivity")).toBe(false);
    expect(isIconD2RawAreaField("not-a-field")).toBe(false);
  });

  it("rejects malformed cycles, impossible leads, and empty ranges", () => {
    const run = new Date("2026-08-31T00:00:00Z");
    expect(() => parseIconD2Run("not-a-date")).toThrow("Invalid ICON-D2 run");
    expect(() => parseIconD2Run("2026-08-31T01:00:00Z")).toThrow("3-hourly UTC cycle");
    expect(() => parseIconD2Run("2026-08-31T00:30:00Z")).toThrow("3-hourly UTC cycle");
    expect(() => parseIconD2Run("2026-08-31T00:00:01Z")).toThrow("3-hourly UTC cycle");
    expect(() => iconD2ForecastHour(run, new Date("2026-08-31T00:30:00Z")))
      .toThrow("whole forecast hour");
    expect(() => iconD2ForecastHour(run, new Date("2026-08-30T23:00:00Z")))
      .toThrow("at or after run time");
    expect(() => iconD2ValidTime(run, -1)).toThrow("0 to 48");
    expect(() => iconD2ValidTime(run, 49)).toThrow("0 to 48");
    expect(() => iconD2NativeForecastHoursInRange(
      run,
      new Date("2026-08-31T12:00:00Z"),
      new Date("2026-08-31T11:00:00Z"),
    )).toThrow("endTime must be at or after startTime");
    expect(() => iconD2NativeForecastHoursInRange(
      run,
      new Date("2026-09-03T00:00:00Z"),
      new Date("2026-09-03T01:00:00Z"),
    )).toThrow("No native ICON-D2 forecast outputs");
  });

  it("keeps the ICON-D2 inventory and expansion failures explicit", () => {
    expect(isIconD2PressureLevel(850)).toBe(true);
    expect(isIconD2PressureLevel(750)).toBe(false);
    expect(isIconD2PressureVariable("wind")).toBe(true);
    expect(isIconD2PressureVariable("specific_humidity")).toBe(false);
    expect(isIconD2Field("wind_10m")).toBe(true);
    expect(isIconD2Field("wind_gust")).toBe(true);
    expect(isIconD2Field("visibility")).toBe(true);
    expect(isIconD2Field("cloud_ceiling_height_msl")).toBe(true);
    expect(isIconD2Field("shallow_convective_cloud_base_height_msl")).toBe(true);
    expect(isIconD2Field("shallow_convective_cloud_top_height_msl")).toBe(true);
    expect(isIconD2Field("dry_convection_top_height_msl")).toBe(true);
    expect(isIconD2Field("column_maximum_reflectivity")).toBe(true);
    expect(isIconD2Field("dew_point_2m")).toBe(false);
    expect(() => expandIconD2RequestedVariables(["specific_humidity"]))
      .toThrow("ICON-D2 pressure variables not supported");
    expect(() => expandIconD2RequestedFields(["dew_point_2m"]))
      .toThrow("ICON-D2 fields not supported");
  });

  it("covers empty/productless and HTTP availability branches in the DWD cache", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "wfg-icon-d2-guards-"));
    try {
      const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
      const cache = new IconD2OpenDataCache(
        rootDir,
        fetchFn as typeof fetch,
        { run: <T>(operation: () => Promise<T>) => operation() },
        async (bytes) => bytes,
      );
      await expect(cache.fetch({
        run: new Date("2026-08-31T00:00:00Z"),
        forecastHour: 6,
        variables: [],
        pressureLevelsHpa: [],
        fields: [],
      })).rejects.toThrow("must contain at least one");
      expect(await cache.isForecastAvailable(
        new Date("2026-08-31T00:00:00Z"),
        6,
        { pressure: false, surface: false },
      )).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();

      const missing = new IconD2OpenDataCache(
        join(rootDir, "missing"),
        vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" })) as typeof fetch,
        { run: <T>(operation: () => Promise<T>) => operation() },
        async (bytes) => bytes,
      );
      expect(await missing.isForecastAvailable(
        new Date("2026-08-31T00:00:00Z"),
        6,
        { pressure: true, surface: false },
      )).toBe(false);

      const forbidden = new IconD2OpenDataCache(
        join(rootDir, "forbidden"),
        vi.fn(async () => new Response(null, { status: 403, statusText: "Forbidden" })) as typeof fetch,
        { run: <T>(operation: () => Promise<T>) => operation() },
        async (bytes) => bytes,
      );
      await expect(forbidden.isForecastAvailable(
        new Date("2026-08-31T00:00:00Z"),
        6,
        { pressure: false, surface: true },
      )).rejects.toThrow("availability request failed");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

function fakeDecodedValues(longitude: number, latitude: number) {
  const gridPoint = { longitude, latitude };
  const temperature = new Map([
    [1000, 290],
    [925, 285],
    [850, 280],
    [700, 268],
    [500, 250],
  ]);
  const height = new Map([
    [1000, 100],
    [925, 750],
    [850, 1500],
    [700, 3000],
    [500, 5600],
  ]);
  return [
    ...[...temperature].flatMap(([pressureHpa, temperatureK]) => [
      { code: "TMP", pressureHpa, value: temperatureK, gridPoint },
      { code: "RH", pressureHpa, value: 60, gridPoint },
      { code: "UGRD", pressureHpa, value: 3, gridPoint },
      { code: "VGRD", pressureHpa, value: 4, gridPoint },
      { code: "HGT", pressureHpa, value: height.get(pressureHpa)!, gridPoint },
      { code: "VVEL", pressureHpa, value: -0.1, gridPoint },
    ]),
    { code: "TMP", heightAboveGroundM: 2, value: 290, gridPoint },
    { code: "UGRD", heightAboveGroundM: 10, value: 3, gridPoint },
    { code: "VGRD", heightAboveGroundM: 10, value: 4, gridPoint },
    {
      code: "GUST",
      heightAboveGroundM: 10,
      maximum: { startForecastHour: 5, endForecastHour: 6 },
      value: 18,
      gridPoint,
    },
    { code: "PRMSL", namedVertical: "mean sea level", value: 101_325, gridPoint },
    { code: "VIS", surface: true, value: 12_000, gridPoint },
    { code: "CEILING", namedVertical: "cloud ceiling", value: 1_800, gridPoint },
    { code: "HBAS_SC", namedVertical: "mean sea level", value: 1_200, gridPoint },
    { code: "HTOP_SC", namedVertical: "mean sea level", value: 2_400, gridPoint },
    { code: "HTOP_DC", namedVertical: "mean sea level", value: 1_800, gridPoint },
    { code: "BREF", namedVertical: "entire atmosphere", value: 30, gridPoint },
    {
      code: "APCP",
      surface: true,
      accumulation: { startForecastHour: 0, endForecastHour: 6 },
      value: 1.5,
      gridPoint,
    },
    {
      code: "RAIN_CON",
      surface: true,
      accumulation: { startForecastHour: 0, endForecastHour: 6 },
      value: 0.8,
      gridPoint,
    },
    {
      code: "SNOW_CON",
      surface: true,
      accumulation: { startForecastHour: 0, endForecastHour: 6 },
      value: 0.2,
      gridPoint,
    },
  ];
}
