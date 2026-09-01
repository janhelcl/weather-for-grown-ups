import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AromeOpenDataCache,
} from "../src/cache/arome-open-data-cache.js";
import {
  expandArome0p01RequestedFields,
} from "../src/catalog/arome.js";
import { searchAtmosphereCatalog } from "../src/catalog/unified-search.js";
import { AromeForecastService } from "../src/core/arome.js";
import { AromeRunResolver } from "../src/core/arome-run.js";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import {
  publicDatasetCoversGeometry,
  queryAtmosphereSchema,
  diagnoseAtmosphereSchema,
} from "../src/schema/unified-api.js";
import {
  aromeForecastHour,
  aromeNativeForecastHoursInRange,
  aromeValidTime,
  buildArome0p01OpenDataUrl,
  floorToAromeCycle,
  parseAromeRun,
} from "../src/sources/arome.js";

describe("AROME 0.01 Open Data naming and cadence", () => {
  const run = new Date("2026-08-31T12:00:00Z");

  it("builds the current Météo-France object-store URL exactly", () => {
    expect(buildArome0p01OpenDataUrl(run, 6, "SP1")).toBe(
      "https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/pnt/"
      + "2026-08-31T12:00:00Z/arome/001/SP1/"
      + "arome__001__SP1__06H__2026-08-31T12:00:00Z.grib2",
    );
    expect(buildArome0p01OpenDataUrl(run, 0, "HP1")).toBe(
      "https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/pnt/"
      + "2026-08-31T12:00:00Z/arome/001/HP1/"
      + "arome__001__HP1__00H__2026-08-31T12:00:00Z.grib2",
    );
  });

  it("keeps 3-hourly cycles, hourly outputs and the 51-hour horizon explicit", () => {
    expect(parseAromeRun("2026-08-31T15:00:00Z").toISOString())
      .toBe("2026-08-31T15:00:00.000Z");
    expect(() => parseAromeRun("2026-08-31T14:00:00Z")).toThrow("3-hourly UTC cycle");
    expect(aromeForecastHour(run, new Date("2026-08-31T18:00:00Z"))).toBe(6);
    expect(aromeNativeForecastHoursInRange(
      run,
      new Date("2026-08-31T12:00:00Z"),
      new Date("2026-08-31T15:00:00Z"),
    )).toEqual([0, 1, 2, 3]);
    expect(aromeValidTime(run, 51).toISOString()).toBe("2026-09-02T15:00:00.000Z");
    expect(() => aromeValidTime(run, 52)).toThrow("0 to 51");
    expect(floorToAromeCycle(new Date("2026-08-31T20:59:59Z")).toISOString())
      .toBe("2026-08-31T18:00:00.000Z");
  });

  it("rejects malformed runs, fractional/negative leads, and empty native ranges", () => {
    expect(() => parseAromeRun("not-a-date")).toThrow("Invalid AROME run");
    expect(() => aromeForecastHour(
      run,
      new Date("2026-08-31T12:30:00Z"),
    )).toThrow("whole forecast hour");
    expect(() => aromeForecastHour(
      run,
      new Date("2026-08-31T11:00:00Z"),
    )).toThrow("at or after run time");
    expect(() => aromeNativeForecastHoursInRange(
      run,
      new Date("2026-08-31T15:00:00Z"),
      new Date("2026-08-31T14:00:00Z"),
    )).toThrow("endTime must be at or after startTime");
    expect(() => aromeNativeForecastHoursInRange(
      run,
      new Date("2026-09-02T16:00:00Z"),
      new Date("2026-09-02T18:00:00Z"),
    )).toThrow("No native AROME forecast outputs");
  });
});

describe("AROME selected-package cache", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "wfg-arome-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("fetches only the required SP1/HP1 packages, combines them once and caches", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const body = new TextEncoder().encode(url.includes("/HP1/") ? "GRIB-HP1" : "GRIB-SP1");
      return new Response(body, { status: 200 });
    });
    const cache = new AromeOpenDataCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );
    const request = {
      run: new Date("2026-08-31T12:00:00Z"),
      forecastHour: 6,
      fields: expandArome0p01RequestedFields([
        "temperature_2m",
        "u_wind_20m",
      ]),
    };

    const first = await cache.fetch(request);
    expect(first.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(first.path)))
      .toBe("GRIB-HP1GRIB-SP1");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.map(([input]) => String(input))).toEqual([
      expect.stringContaining("/HP1/arome__001__HP1__06H__"),
      expect.stringContaining("/SP1/arome__001__SP1__06H__"),
    ]);

    const second = await cache.fetch(request);
    expect(second).toMatchObject({ path: first.path, cacheHit: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects empty selections and non-GRIB upstream payloads", async () => {
    const cache = new AromeOpenDataCache(
      rootDir,
      vi.fn(async () => new Response("not grib", { status: 200 })) as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );

    await expect(cache.fetch({
      run: new Date("2026-08-31T12:00:00Z"),
      forecastHour: 6,
      fields: [],
    })).rejects.toThrow("at least one supported field");

    await expect(cache.fetch({
      run: new Date("2026-08-31T12:00:00Z"),
      forecastHour: 6,
      fields: expandArome0p01RequestedFields(["temperature_2m"]),
    })).rejects.toThrow("did not start with GRIB");
  });

  it("treats missing requested package probes as unavailable", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 404 }));
    const cache = new AromeOpenDataCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );
    expect(await cache.isForecastAvailable(
      new Date("2026-08-31T12:00:00Z"),
      6,
      { sp1: true, hp1: false },
    )).toBe(false);
    expect(await cache.isForecastAvailable(
      new Date("2026-08-31T12:00:00Z"),
      6,
      { sp1: false, hp1: false },
    )).toBe(false);
  });

  it("uses HEAD probes only for packages required by run resolution", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const cache = new AromeOpenDataCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );
    expect(await cache.isForecastAvailable(
      new Date("2026-08-31T12:00:00Z"),
      6,
      { sp1: true, hp1: false },
    )).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe("HEAD");
  });
});


describe("AROME run resolution", () => {
  const products = { sp1: true, hp1: false };

  it("walks back unpublished cycles and caches the resolved latest run", async () => {
    const probe = {
      isForecastAvailable: vi.fn(async (run: Date) => run.getUTCHours() === 15),
    };
    const resolver = new AromeRunResolver(
      probe,
      () => new Date("2026-08-31T20:00:00Z").getTime(),
      60_000,
      4,
    );
    const requirement = {
      type: "valid_time" as const,
      validTime: new Date("2026-08-31T18:00:00Z"),
      products,
    };

    expect((await resolver.resolveLatestRun(requirement)).toISOString())
      .toBe("2026-08-31T15:00:00.000Z");
    expect(probe.isForecastAvailable).toHaveBeenCalledTimes(2);

    expect((await resolver.resolveLatestRun(requirement)).toISOString())
      .toBe("2026-08-31T15:00:00.000Z");
    expect(probe.isForecastAvailable).toHaveBeenCalledTimes(2);
  });

  it("resolves a latest complete run by probing the terminal lead", async () => {
    const probe = {
      isForecastAvailable: vi.fn(async (run: Date, forecastHour: number) =>
        run.getUTCHours() === 15 && forecastHour === 51),
    };
    const resolver = new AromeRunResolver(
      probe,
      () => new Date("2026-08-31T20:00:00Z").getTime(),
      60_000,
      4,
    );

    expect((await resolver.resolveLatestCompleteRun(products)).toISOString())
      .toBe("2026-08-31T15:00:00.000Z");
    expect(probe.isForecastAvailable.mock.calls.map(([, hour]) => hour))
      .toEqual([51, 51]);
  });

  it("checks both ends of a requested time range and rejects ranges beyond f51", async () => {
    const probe = {
      isForecastAvailable: vi.fn(async () => true),
    };
    const resolver = new AromeRunResolver(
      probe,
      () => new Date("2026-08-31T20:00:00Z").getTime(),
      60_000,
      4,
    );

    expect((await resolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-08-31T17:00:00Z"),
      endTime: new Date("2026-08-31T19:00:00Z"),
      products,
    })).toISOString()).toBe("2026-08-31T15:00:00.000Z");
    expect(probe.isForecastAvailable.mock.calls.map(([, hour]) => hour))
      .toEqual([2, 4]);

    await expect(resolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-08-31T18:00:00Z"),
      endTime: new Date("2026-09-03T00:00:00Z"),
      products,
    })).rejects.toThrow("beyond the 51-hour AROME horizon");
  });

  it("fails clearly when no recent published cycle satisfies the request", async () => {
    const resolver = new AromeRunResolver(
      { isForecastAvailable: vi.fn(async () => false) },
      () => new Date("2026-08-31T20:00:00Z").getTime(),
      60_000,
      2,
    );
    await expect(resolver.resolveLatestRun({
      type: "valid_time",
      validTime: new Date("2026-08-31T18:00:00Z"),
      products,
    })).rejects.toThrow("Could not find an AROME run");
  });
});

describe("AROME unified capabilities", () => {
  it("accepts field queries but refuses to synthesize pressure-profile parity", () => {
    expect(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["temperature_2m", "wind_10m"] },
      forecast: { run: "2026-08-31T12:00:00Z" },
    }).dataset).toBe("arome");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    })).toThrow("field-only capability");

    expect(() => diagnoseAtmosphereSchema.parse({
      dataset: "arome",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T18:00:00Z" },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700],
        diagnostics: ["freezing_level_crossings"],
      },
    })).toThrow("pressure-based diagnostics");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["mean_sea_level_pressure"] },
    })).toThrow("AROME 0.01° fields not supported");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: {
        type: "area",
        westLongitude: 2,
        eastLongitude: 3,
        southLatitude: 48,
        northLatitude: 49,
      },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["wind_10m"] },
    })).toThrow("native scalar field");
  });

  it("advertises model mesh, public product grid, domain and field inventory truthfully", () => {
    expect(publicDatasetCoversGeometry("arome", {
      type: "point",
      latitude: 50.08,
      longitude: 14.43,
    })).toBe(true);
    expect(publicDatasetCoversGeometry("arome", {
      type: "point",
      latitude: 48.2,
      longitude: 16.4,
    })).toBe(false);

    const result = searchAtmosphereCatalog({
      datasets: ["arome"],
      search: "wind",
      sections: ["fields"],
      limit: 30,
    });
    expect(result.datasetCapabilities[0]).toMatchObject({
      dataset: "arome",
      provider: "meteo_france",
      spatialDomain: {
        scope: "limited_area",
        bounds: {
          westLongitude: -12,
          eastLongitude: 16,
          southLatitude: 37.5,
          northLatitude: 55.4,
        },
      },
      horizontalGridDegrees: 0.01,
      nativeGrid: {
        type: "lambert_conformal",
        nominalResolution: { value: 1.3, unit: "km" },
      },
      maxForecastHour: 51,
      nativeTimeCadenceHours: [1],
    });
    expect(result.matches.some((match) =>
      match.id === "wind_10m"
      && match.support.some((support) => support.dataset === "arome"))).toBe(true);
    expect(searchAtmosphereCatalog({
      datasets: ["arome"],
      sections: ["variables", "layer_diagnostics", "profile_diagnostics"],
      limit: 30,
    }).matches).toEqual([]);
  });

  it("rejects out-of-domain queries before touching the AROME adapter", async () => {
    const arome = { query: vi.fn(async () => ({ route: "arome" })) };
    const service = new UnifiedAtmosphereQueryService({
      adapters: { arome },
    });
    await expect(service.query({
      dataset: "arome",
      geometry: { type: "point", latitude: 48.2, longitude: 16.4 },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      forecast: { run: "2026-08-31T12:00:00Z" },
    })).rejects.toThrow(/outside|domain|coverage/i);
    expect(arome.query).not.toHaveBeenCalled();
  });
});

describe("AROME deterministic field operations", () => {
  const run = new Date("2026-08-31T12:00:00Z");
  const cache = {
    fetch: vi.fn(async () => ({ path: "/tmp/arome-test.grib2", cacheHit: false })),
    isForecastAvailable: vi.fn(async () => true),
  };
  const decoder = {
    engine: "gribberish" as const,
    extractPoint: vi.fn(async (_path: string, longitude: number, latitude: number) =>
      fakeDecodedValues(longitude, latitude)),
  };
  const areaDecoder = {
    engine: "gribberish" as const,
    summarizeSelectedMessage: vi.fn(async (_path: string, _box: unknown, selector: any) => ({
      totalGridPoints: 9,
      undefinedGridPoints: 0,
      definedGridPoints: 9,
      mean: selector.code === "TMP" ? 280 : 4,
      min: selector.code === "TMP" ? 278 : 2,
      max: selector.code === "TMP" ? 282 : 6,
      temporal: { type: "instantaneous" as const },
    })),
  };
  const areaGridDecoder = {
    engine: "gribberish" as const,
    extractSelectedMessage: vi.fn(async (_path: string, _box: unknown, selector: any) => ({
      points: [
        { longitude: 2, latitude: 48, value: selector.code === "TMP" ? 278 : 2 },
        { longitude: 2.1, latitude: 48.1, value: selector.code === "TMP" ? 280 : 4 },
        { longitude: 2.2, latitude: 48.2, value: selector.code === "TMP" ? 282 : 6 },
      ],
      temporal: { type: "instantaneous" as const },
    })),
  };
  const service = () => new AromeForecastService({
    cache,
    decoder,
    areaDecoder: areaDecoder as any,
    areaGridDecoder: areaGridDecoder as any,
  });

  beforeEach(() => vi.clearAllMocks());

  it("supports field-only point and hourly range queries", async () => {
    const point = await service().query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: { type: "point", latitude: 48.86, longitude: 2.35 },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["temperature_2m", "relative_humidity_2m", "wind_10m"] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(point).toMatchObject({
      model: "arome_0p01",
      forecastHour: 6,
      levels: [],
      source: {
        provider: "Météo-France Open Data",
        access: "meteo_france_open_data",
        nativeGrid: { type: "lambert_conformal", nominalResolutionKm: 1.3 },
        productGrid: { type: "regular_latlon", resolutionDegrees: 0.01, product: "EURW1S100" },
      },
    });
    expect(point.fields.find((field: any) => field.id === "temperature_2m").values.temperatureC)
      .toBeCloseTo(6.85, 8);
    expect(point.fields.find((field: any) => field.id === "relative_humidity_2m").values.relativeHumidityPct)
      .toBe(70);
    expect(point.fields.find((field: any) => field.id === "wind_10m").values.windSpeedMs)
      .toBe(5);

    const range = await service().query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: { type: "point", latitude: 48.86, longitude: 2.35 },
      time: {
        from: "2026-08-31T18:00:00Z",
        to: "2026-08-31T20:00:00Z",
      },
      selection: { fields: ["temperature_2m"] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(range.series.map((step: any) => step.forecastHour)).toEqual([6, 7, 8]);
    expect(range.series.every((step: any) => step.levels.length === 0)).toBe(true);
  });

  it("reuses one package file for multi-point and transect decoding", async () => {
    const points = await service().query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: {
        type: "points",
        points: [
          { latitude: 48.86, longitude: 2.35 },
          { latitude: 50.85, longitude: 4.35 },
        ],
      },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["wind_20m"] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(points.points).toHaveLength(2);
    expect(cache.fetch).toHaveBeenCalledTimes(1);
    expect(decoder.extractPoint).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    const transect = await service().query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: {
        type: "transect",
        start: { latitude: 48.5, longitude: 2 },
        end: { latitude: 50, longitude: 5 },
        samples: 3,
      },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(transect.samples).toHaveLength(3);
    expect(transect.totalDistanceKm).toBeGreaterThan(0);
    expect(cache.fetch).toHaveBeenCalledTimes(1);
    expect(decoder.extractPoint).toHaveBeenCalledTimes(3);
  });

  it("supports bounded multi-point time ranges with one package fetch per lead", async () => {
    const result = await service().query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: {
        type: "points",
        points: [
          { latitude: 48.86, longitude: 2.35 },
          { latitude: 50.85, longitude: 4.35 },
        ],
      },
      time: {
        from: "2026-08-31T18:00:00Z",
        to: "2026-08-31T19:00:00Z",
      },
      selection: { fields: ["temperature_2m"] },
      limits: { maxPointSteps: 4 },
      forecast: { run: run.toISOString() },
    })) as any;

    expect(result.series.map((step: any) => step.forecastHour)).toEqual([6, 7]);
    expect(result.series.every((step: any) => step.points.length === 2)).toBe(true);
    expect(cache.fetch).toHaveBeenCalledTimes(2);
    expect(decoder.extractPoint).toHaveBeenCalledTimes(4);
  });

  it("enforces native-step and multi-point range work bounds", async () => {
    await expect(service().query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: { type: "point", latitude: 48.86, longitude: 2.35 },
      time: {
        from: "2026-08-31T18:00:00Z",
        to: "2026-08-31T20:00:00Z",
        maxSteps: 2,
      },
      selection: { fields: ["temperature_2m"] },
      forecast: { run: run.toISOString() },
    }))).rejects.toThrow("exceeding maxSteps=2");

    await expect(service().query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: {
        type: "points",
        points: [
          { latitude: 48.86, longitude: 2.35 },
          { latitude: 50.85, longitude: 4.35 },
        ],
      },
      time: {
        from: "2026-08-31T18:00:00Z",
        to: "2026-08-31T20:00:00Z",
      },
      selection: { fields: ["temperature_2m"] },
      limits: { maxPointSteps: 5 },
      forecast: { run: run.toISOString() },
    }))).rejects.toThrow("exceeding maxPointSteps=5");
  });

  it("rejects oversized areas before source access and empty decoder output clearly", async () => {
    await expect(service().query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: {
        type: "area",
        westLongitude: 2,
        eastLongitude: 3,
        southLatitude: 48,
        northLatitude: 49,
      },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      limits: { maxGridPoints: 100 },
      forecast: { run: run.toISOString() },
    }))).rejects.toThrow("exceeding maxGridPoints=100");
    expect(cache.fetch).not.toHaveBeenCalled();

    const emptyDecoderService = new AromeForecastService({
      cache,
      decoder: {
        engine: "gribberish",
        extractPoint: vi.fn(async () => []),
      },
      areaDecoder: areaDecoder as any,
      areaGridDecoder: areaGridDecoder as any,
    });
    await expect(emptyDecoderService.query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: { type: "point", latitude: 48.86, longitude: 2.35 },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      forecast: { run: run.toISOString() },
    }))).rejects.toThrow("decoder returned no grid point");
  });

  it("supports bounded-area scalar summaries and distributions", async () => {
    const area = await service().query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: {
        type: "area",
        westLongitude: 2,
        eastLongitude: 2.2,
        southLatitude: 48,
        northLatitude: 48.2,
      },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      aggregate: {
        percentiles: [50],
        thresholds: [{ operator: "gte", value: 6 }],
        includeExtremaLocations: true,
      },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(area.field.id).toBe("temperature_2m");
    expect(area.statistics.mean).toBeCloseTo(6.85, 8);
    expect(area.distribution.percentiles[0].value).toBeCloseTo(6.85, 8);
    expect(area.source.productGrid).toMatchObject({
      resolutionDegrees: 0.01,
      product: "EURW1S100",
    });

    vi.clearAllMocks();
    const compact = await service().query(queryAtmosphereSchema.parse({
      dataset: "arome",
      geometry: {
        type: "area",
        westLongitude: 2,
        eastLongitude: 2.2,
        southLatitude: 48,
        northLatitude: 48.2,
      },
      time: { at: "2026-08-31T18:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      forecast: { run: run.toISOString() },
    })) as any;
    expect(compact.distribution).toBeUndefined();
    expect(compact.statistics.mean).toBeCloseTo(6.85, 8);
    expect(areaDecoder.summarizeSelectedMessage).toHaveBeenCalledOnce();
    expect(areaGridDecoder.extractSelectedMessage).not.toHaveBeenCalled();
  });
});

function fakeDecodedValues(longitude: number, latitude: number) {
  const gridPoint = { longitude, latitude };
  return [
    { code: "TMP", heightAboveGroundM: 2, value: 280, gridPoint },
    { code: "RH", heightAboveGroundM: 2, value: 70, gridPoint },
    { code: "UGRD", heightAboveGroundM: 10, value: 3, gridPoint },
    { code: "VGRD", heightAboveGroundM: 10, value: 4, gridPoint },
    { code: "UGRD", heightAboveGroundM: 20, value: 5, gridPoint },
    { code: "VGRD", heightAboveGroundM: 20, value: 12, gridPoint },
    { code: "UGRD", heightAboveGroundM: 50, value: 8, gridPoint },
    { code: "VGRD", heightAboveGroundM: 50, value: 15, gridPoint },
    { code: "UGRD", heightAboveGroundM: 100, value: 7, gridPoint },
    { code: "VGRD", heightAboveGroundM: 100, value: 24, gridPoint },
  ];
}
