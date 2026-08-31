import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IconD2OpenDataCache,
  bunzip2,
} from "../src/cache/icon-d2-open-data-cache.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../src/catalog/variables.js";
import { searchAtmosphereCatalog } from "../src/catalog/unified-search.js";
import { IconD2ForecastService } from "../src/core/icon-d2.js";
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
      latitude: 51.51,
      longitude: -0.12,
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
  };
  const service = () => new IconD2ForecastService({
    cache,
    decoder,
    runProvider,
    areaDecoder: areaDecoder as any,
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
});

function fakeDecodedValues(longitude: number, latitude: number) {
  const gridPoint = { longitude, latitude };
  const temperature = new Map([[1000, 290], [850, 280]]);
  const height = new Map([[1000, 100], [850, 1500]]);
  return [...temperature].flatMap(([pressureHpa, temperatureK]) => [
    { code: "TMP", pressureHpa, value: temperatureK, gridPoint },
    { code: "RH", pressureHpa, value: 60, gridPoint },
    { code: "UGRD", pressureHpa, value: 3, gridPoint },
    { code: "VGRD", pressureHpa, value: 4, gridPoint },
    { code: "HGT", pressureHpa, value: height.get(pressureHpa)!, gridPoint },
    { code: "VVEL", pressureHpa, value: -0.1, gridPoint },
  ]);
}
