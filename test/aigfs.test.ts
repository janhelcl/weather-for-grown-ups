import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpstreamAccessPolicy } from "../src/access/access-policy.js";
import { AigfsNomadsSubsetCache } from "../src/cache/aigfs-nomads-subset-cache.js";
import {
  AIGFS_PRESSURE_LEVELS_HPA,
  expandAigfsRequestedFields,
  expandAigfsRequestedVariables,
  isAigfsAreaField,
  isAigfsField,
  isAigfsPressureLevel,
  isAigfsPressureVariable,
} from "../src/catalog/aigfs.js";
import { searchAtmosphereCatalog } from "../src/catalog/unified-search.js";
import {
  createAtmosphericQueryAdapterRegistry,
} from "../src/core/query-adapters/registry.js";
import { AigfsForecastService } from "../src/core/aigfs.js";
import { AigfsRunResolver, resolveAigfsRun } from "../src/core/aigfs-run.js";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-query.js";
import {
  AIGFS_NATIVE_FORECAST_HOURS,
  aigfsForecastHour,
  aigfsNativeForecastHoursInRange,
  aigfsValidTime,
  buildAigfsNomadsIndexUrl,
  buildAigfsNomadsUrl,
  floorToAigfsCycle,
  parseAigfsRun,
} from "../src/sources/aigfs.js";
import { diagnoseAtmosphereSchema, queryAtmosphereSchema } from "../src/schema/unified-api.js";
import type { DecodedValue } from "../src/core/types.js";

const passthroughPolicy: UpstreamAccessPolicy = {
  run: async <T>(operation: () => Promise<T>) => operation(),
};

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "wfg-aigfs-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("AIGFS source contract", () => {
  it("builds operational NOMADS pres/sfc URLs and keeps the 6-hour native cadence", () => {
    const run = new Date("2026-08-30T00:00:00Z");
    expect(buildAigfsNomadsUrl(run, 6, "pres")).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod/aigfs.20260830/00/model/atmos/grib2/aigfs.t00z.pres.f006.grib2",
    );
    expect(buildAigfsNomadsIndexUrl(run, 6, "sfc")).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod/aigfs.20260830/00/model/atmos/grib2/aigfs.t00z.sfc.f006.grib2.idx",
    );
    expect(AIGFS_NATIVE_FORECAST_HOURS[0]).toBe(0);
    expect(AIGFS_NATIVE_FORECAST_HOURS.at(-1)).toBe(384);
    expect(AIGFS_NATIVE_FORECAST_HOURS).toHaveLength(65);
    expect(aigfsForecastHour(run, new Date("2026-08-30T06:00:00Z"))).toBe(6);
    expect(() => aigfsForecastHour(run, new Date("2026-08-30T03:00:00Z")))
      .toThrow("every 6 forecast hours");
    expect(aigfsNativeForecastHoursInRange(
      run,
      new Date("2026-08-30T03:00:00Z"),
      new Date("2026-08-30T15:00:00Z"),
    )).toEqual([6, 12]);
  });

  it("advertises exactly the published 13 pressure levels", () => {
    expect(AIGFS_PRESSURE_LEVELS_HPA).toEqual([
      50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 850, 925, 1000,
    ]);
  });

  it("uses one covering partial request per product and reuses cached indices", async () => {
    const pressureIndex = [
      "1:0:d=2026083000:HGT:850 mb:6 hour fcst:",
      "2:8:d=2026083000:SPFH:850 mb:6 hour fcst:",
      "3:16:d=2026083000:TMP:850 mb:6 hour fcst:",
      "4:24:d=2026083000:UGRD:850 mb:6 hour fcst:",
      "5:32:d=2026083000:VGRD:850 mb:6 hour fcst:",
      "6:40:d=2026083000:VVEL:850 mb:6 hour fcst:",
      "7:48:d=2026083000:HGT:700 mb:6 hour fcst:",
    ].join("\n");
    const surfaceIndex = [
      "1:0:d=2026083000:UGRD:10 m above ground:6 hour fcst:",
      "2:8:d=2026083000:VGRD:10 m above ground:6 hour fcst:",
      "3:16:d=2026083000:TMP:2 m above ground:6 hour fcst:",
      "4:24:d=2026083000:PRMSL:mean sea level:6 hour fcst:",
      "5:32:d=2026083000:APCP:surface:0-6 hour acc fcst:",
      "6:40:d=2026083000:APCP:surface:0-6 hour acc fcst:",
    ].join("\n");

    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(".idx")) {
        return new Response(url.includes(".pres.") ? pressureIndex : surfaceIndex, { status: 200 });
      }
      const range = new Headers(init?.headers).get("range");
      if (range === null) return new Response("missing range", { status: 400 });
      const bytes = new TextEncoder().encode("GRIB".padEnd(64, "x"));
      return new Response(bytes, { status: 206 });
    });

    const cache = new AigfsNomadsSubsetCache(
      rootDir,
      fetchFn as typeof fetch,
      passthroughPolicy,
    );
    const request = {
      run: new Date("2026-08-30T00:00:00Z"),
      forecastHour: 6,
      variables: expandAigfsRequestedVariables(["temperature", "u_wind"]),
      pressureLevelsHpa: [850],
      fields: expandAigfsRequestedFields(["temperature_2m", "mean_sea_level_pressure"]),
    };

    const first = await cache.fetch(request);
    expect(first.cacheHit).toBe(false);
    expect((await readFile(first.path)).byteLength).toBe(128);

    const ranges = fetchFn.mock.calls
      .map(([, init]) => new Headers(init?.headers).get("range"))
      .filter((value): value is string => value !== null);
    expect(ranges).toEqual(["bytes=16-31", "bytes=16-31"]);

    const indexCallsAfterFirst = fetchFn.mock.calls.filter(([input]) => String(input).endsWith(".idx")).length;
    const second = await cache.fetch(request);
    expect(second).toEqual({ path: first.path, cacheHit: true });
    expect(fetchFn.mock.calls.filter(([input]) => String(input).endsWith(".idx"))).toHaveLength(indexCallsAfterFirst);
  });
});

describe("AIGFS unified contract", () => {
  const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

  it("accepts supported state and rejects invented capability", () => {
    expect(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: point,
      time: { at: "2026-08-30T12:00:00Z" },
      selection: {
        variables: ["temperature", "specific_humidity", "wind"],
        pressureLevelsHpa: [850, 700],
        fields: ["temperature_2m", "mean_sea_level_pressure"],
      },
    }).dataset).toBe("aigfs");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: point,
      time: { at: "2026-08-30T12:00:00Z" },
      selection: { variables: ["relative_humidity"], pressureLevelsHpa: [850] },
    })).toThrow("AIGFS pressure variables not supported");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: point,
      time: { at: "2026-08-30T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [750] },
    })).toThrow("AIGFS pressure levels not supported");

    expect(() => diagnoseAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: point,
      time: { at: "2026-08-30T12:00:00Z" },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850, 700],
        parcel: "surface_2m",
      },
    })).toThrow("AIGFS parcel diagnostics are not exposed");
  });

  it("rejects derived area scalars while keeping point derivations available", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 15,
        southLatitude: 49,
        northLatitude: 50,
      },
      time: { at: "2026-08-30T12:00:00Z" },
      selection: { variables: ["wind"], pressureLevelsHpa: [850] },
    })).toThrow("native scalar pressure variable");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 15,
        southLatitude: 49,
        northLatitude: 50,
      },
      time: { at: "2026-08-30T12:00:00Z" },
      selection: { fields: ["wind_10m"] },
    })).toThrow("native scalar field");
  });

  it("routes AIGFS through the same public query service", async () => {
    const aigfs = {
      query: vi.fn(async () => ({
        model: "aigfs_0p25",
        route: "aigfs-profile",
      })),
    };
    const service = new UnifiedAtmosphereQueryService({
      adapters: createAtmosphericQueryAdapterRegistry({ aigfs: aigfs as any }),
    });

    const result = await service.query({
      dataset: "aigfs",
      geometry: point,
      time: { at: "2026-08-30T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });

    expect(result).toMatchObject({
      dataset: "aigfs",
      internalDatasetId: "aigfs_0p25",
      kind: "deterministic",
      result: { route: "aigfs-profile" },
    });
    expect(aigfs.query).toHaveBeenCalledWith(expect.objectContaining({ dataset: "aigfs" }));
  });

  it("discovers AIGFS model class, cadence, state and diagnostics in the canonical catalog", () => {
    const catalog = searchAtmosphereCatalog({
      datasets: ["aigfs"],
      sections: ["variables", "fields", "layer_diagnostics", "profile_diagnostics", "parcel_definitions"],
      limit: 100,
    });

    expect(catalog.datasetCapabilities[0]).toMatchObject({
      dataset: "aigfs",
      provider: "noaa",
      modelClass: "ai",
      horizontalGridDegrees: 0.25,
      maxForecastHour: 384,
      nativeForecastIntervalHours: 6,
    });
    expect(catalog.matches.some((match) => match.id === "temperature")).toBe(true);
    expect(catalog.matches.some((match) => match.id === "mean_sea_level_pressure")).toBe(true);
    expect(catalog.matches.some((match) => match.id === "temperature_lapse_rate")).toBe(true);
    expect(catalog.matches.some((match) => match.section === "parcel_definitions")).toBe(false);
  });
});


describe("AIGFS deterministic service composition", () => {
  const run = new Date("2026-08-30T00:00:00Z");
  const runProvider = {
    resolveLatestRun: vi.fn(async () => run),
    resolveLatestCompleteRun: vi.fn(async () => run),
  };
  const cache = {
    fetch: vi.fn(async () => ({ path: "/tmp/aigfs-test.grib2", cacheHit: false })),
  };
  const decoder = {
    engine: "gribberish" as const,
    extractPoint: vi.fn(async (_path: string, longitude: number, latitude: number) =>
      fakeDecodedValues(longitude, latitude)),
  };
  const areaDecoder = {
    engine: "gribberish" as const,
    summarizeBox: vi.fn(async () => fakeStats(280, 278, 282)),
    summarizeSelectedMessage: vi.fn(async (_path: string, _box: unknown, selector: any) => ({
      ...fakeStats(selector.code === "TMP" ? 280 : 101_325, selector.code === "TMP" ? 278 : 101_000, selector.code === "TMP" ? 282 : 101_700),
      temporal: { type: "instantaneous" as const },
    })),
  };
  const areaGridDecoder = {
    engine: "gribberish" as const,
    extractBox: vi.fn(async () => [
      { longitude: 14, latitude: 49, value: 278 },
      { longitude: 14.25, latitude: 49, value: 280 },
      { longitude: 14.5, latitude: 49, value: 282 },
    ]),
    extractSelectedMessage: vi.fn(async (_path: string, _box: unknown, selector: any) => ({
      points: [
        { longitude: 14, latitude: 49, value: selector.code === "TMP" ? 278 : 101_000 },
        { longitude: 14.25, latitude: 49, value: selector.code === "TMP" ? 280 : 101_325 },
        { longitude: 14.5, latitude: 49, value: selector.code === "TMP" ? 282 : 101_700 },
      ],
      temporal: { type: "instantaneous" as const },
    })),
  };

  function service() {
    return new AigfsForecastService({
      cache: cache as any,
      decoder,
      runProvider,
      areaDecoder: areaDecoder as any,
      areaGridDecoder: areaGridDecoder as any,
    });
  }

  it("normalizes mixed point state and preserves requested derived fields", async () => {
    const result = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: {
        variables: ["temperature", "wind", "specific_humidity"],
        pressureLevelsHpa: [850, 700],
        fields: ["temperature_2m", "wind_10m", "mean_sea_level_pressure", "total_precipitation"],
      },
      forecast: { run: "latest" },
    })) as any;

    expect(result).toMatchObject({
      model: "aigfs_0p25",
      run: "2026-08-30T00:00:00.000Z",
      validTime: "2026-08-30T06:00:00.000Z",
      forecastHour: 6,
      source: { provider: "NOAA NOMADS", access: "nomads_range", decoder: "gribberish" },
    });
    expect(result.levels).toHaveLength(2);
    expect(result.levels[0]).toMatchObject({
      pressureHpa: 850,
      temperatureC: expect.any(Number),
      windSpeedMs: expect.any(Number),
      specificHumidityKgKg: expect.any(Number),
    });
    expect(result.fields.map((field: any) => field.id)).toEqual([
      "temperature_2m", "wind_10m", "mean_sea_level_pressure", "total_precipitation",
    ]);
    expect(result.fields.find((field: any) => field.id === "temperature_2m").values.temperatureC)
      .toBeCloseTo(16.85, 8);
  });

  it("composes native-cadence point and multi-point ranges", async () => {
    const pointRange = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2026-08-30T06:00:00Z",
        to: "2026-08-30T12:00:00Z",
        maxSteps: 2,
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    })) as any;
    expect(pointRange.series.map((step: any) => step.forecastHour)).toEqual([6, 12]);

    const matrix = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: {
        from: "2026-08-30T06:00:00Z",
        to: "2026-08-30T12:00:00Z",
        maxSteps: 2,
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      limits: { maxPointSteps: 4 },
    })) as any;
    expect(matrix.series).toHaveLength(2);
    expect(matrix.series.every((step: any) => step.points.length === 2)).toBe(true);
  });

  it("reuses one fetched slice for multi-point and transect sampling", async () => {
    cache.fetch.mockClear();
    const points = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature", "wind"], pressureLevelsHpa: [850] },
    })) as any;
    expect(points.points).toHaveLength(2);
    expect(cache.fetch).toHaveBeenCalledTimes(1);

    cache.fetch.mockClear();
    const transect = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "transect",
        start: { latitude: 49, longitude: 14 },
        end: { latitude: 50, longitude: 15 },
        samples: 3,
      },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    })) as any;
    expect(transect.samples).toHaveLength(3);
    expect(transect.totalDistanceKm).toBeGreaterThan(0);
    expect(cache.fetch).toHaveBeenCalledTimes(1);
  });

  it("supports scalar area statistics and rich distributions", async () => {
    const pressure = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49,
        northLatitude: 49.5,
      },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    })) as any;
    expect(pressure.variable).toMatchObject({ id: "temperature", pressureHpa: 850, unit: "degC" });
    expect(pressure.statistics.mean).toBeCloseTo(6.85, 8);

    const distribution = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49,
        northLatitude: 49.5,
      },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      aggregate: {
        percentiles: [50],
        thresholds: [{ operator: "gte", value: 6 }],
        includeExtremaLocations: true,
      },
    })) as any;
    expect(distribution.field.id).toBe("temperature_2m");
    expect(distribution.statistics.mean).toBeCloseTo(6.85, 8);
    expect(distribution.distribution.percentiles[0].value).toBeCloseTo(6.85, 8);
    expect(distribution.distribution.extrema.min.gridPoint).toEqual({ latitude: 49, longitude: 14 });
  });

  it("derives layer/profile diagnostics at one time and through a range", async () => {
    const layer = await service().diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate", "wind_shear"],
      },
    })) as any;
    expect(layer.diagnostics).toHaveLength(2);
    expect(layer.layer.depthGpm).toBeGreaterThan(0);

    const profile = await service().diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
        diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      },
    })) as any;
    expect(profile.diagnostics).toHaveLength(2);

    const range = await service().diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2026-08-30T06:00:00Z",
        to: "2026-08-30T12:00:00Z",
        maxSteps: 2,
      },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
    })) as any;
    expect(range.series.map((step: any) => step.forecastHour)).toEqual([6, 12]);
    expect(range.series.every((step: any) => step.kind === "layer")).toBe(true);
  });

  it("enforces service guardrails even below the schema layer", async () => {
    await expect(service().query(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50, longitude: 14 },
          { latitude: 51, longitude: 15 },
        ],
      },
      time: {
        from: "2026-08-30T06:00:00Z",
        to: "2026-08-30T12:00:00Z",
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      limits: { maxPointSteps: 3 },
    }))).rejects.toThrow("exceeding maxPointSteps=3");

    await expect(service().query(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "area",
        westLongitude: 0,
        eastLongitude: 10,
        southLatitude: 0,
        northLatitude: 10,
      },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      limits: { maxGridPoints: 10 },
    }))).rejects.toThrow("exceeding maxGridPoints=10");
  });
});

function fakeDecodedValues(longitude: number, latitude: number): DecodedValue[] {
  const gridPoint = { longitude, latitude };
  const temperaturesK = new Map([
    [1000, 290],
    [925, 285],
    [850, 280],
    [700, 268],
    [500, 250],
  ]);
  const heights = new Map([
    [1000, 100],
    [925, 750],
    [850, 1500],
    [700, 3000],
    [500, 5600],
  ]);
  const pressureValues: DecodedValue[] = [];
  for (const [pressureHpa, temperatureK] of temperaturesK) {
    pressureValues.push(
      { code: "TMP", pressureHpa, value: temperatureK, gridPoint },
      { code: "UGRD", pressureHpa, value: 5 + pressureHpa / 1000, gridPoint },
      { code: "VGRD", pressureHpa, value: 2, gridPoint },
      { code: "HGT", pressureHpa, value: heights.get(pressureHpa)!, gridPoint },
      { code: "SPFH", pressureHpa, value: 0.004, gridPoint },
      { code: "VVEL", pressureHpa, value: -0.1, gridPoint },
    );
  }
  return [
    ...pressureValues,
    { code: "TMP", heightAboveGroundM: 2, value: 290, gridPoint },
    { code: "UGRD", heightAboveGroundM: 10, value: 5, gridPoint },
    { code: "VGRD", heightAboveGroundM: 10, value: 2, gridPoint },
    { code: "PRMSL", namedVertical: "mean sea level", value: 101_325, gridPoint },
    {
      code: "APCP",
      surface: true,
      accumulation: { startForecastHour: 0, endForecastHour: 6 },
      value: 1.5,
      gridPoint,
    },
  ];
}

function fakeStats(mean: number, min: number, max: number) {
  return {
    totalGridPoints: 9,
    undefinedGridPoints: 0,
    definedGridPoints: 9,
    mean,
    min,
    max,
  };
}


describe("AIGFS run resolution", () => {
  it("walks back cycles until the requested native valid time is published and caches the answer", async () => {
    const availableRun = new Date("2026-08-30T06:00:00Z");
    const probe = {
      isForecastAvailable: vi.fn(async (run: Date, forecastHour: number) =>
        run.getTime() === availableRun.getTime() && forecastHour === 6),
    };
    const resolver = new AigfsRunResolver(
      probe,
      () => new Date("2026-08-30T13:00:00Z").getTime(),
      60_000,
      4,
    );
    const requirement = {
      type: "valid_time" as const,
      validTime: new Date("2026-08-30T12:00:00Z"),
      products: { pressure: true, surface: false },
    };

    expect(await resolver.resolveLatestRun(requirement)).toEqual(availableRun);
    const calls = probe.isForecastAvailable.mock.calls.length;
    expect(await resolver.resolveLatestRun(requirement)).toEqual(availableRun);
    expect(probe.isForecastAvailable).toHaveBeenCalledTimes(calls);
  });

  it("checks the full horizon for latest_complete and both ends of a range", async () => {
    const run = new Date("2026-08-30T00:00:00Z");
    const probe = {
      isForecastAvailable: vi.fn(async (candidate: Date, forecastHour: number) =>
        candidate.getTime() === run.getTime() && [6, 18, 384].includes(forecastHour)),
    };
    const resolver = new AigfsRunResolver(
      probe,
      () => new Date("2026-08-30T05:00:00Z").getTime(),
      60_000,
      2,
    );

    expect(await resolver.resolveLatestCompleteRun({ pressure: true, surface: true })).toEqual(run);
    expect(probe.isForecastAvailable).toHaveBeenCalledWith(
      run,
      384,
      { pressure: true, surface: true },
    );

    expect(await resolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-08-30T06:00:00Z"),
      endTime: new Date("2026-08-30T18:00:00Z"),
      products: { pressure: true, surface: false },
    })).toEqual(run);
    expect(probe.isForecastAvailable).toHaveBeenCalledWith(
      run,
      6,
      { pressure: true, surface: false },
    );
    expect(probe.isForecastAvailable).toHaveBeenCalledWith(
      run,
      18,
      { pressure: true, surface: false },
    );
  });

  it("parses explicit cycles without probing and rejects impossible latest ranges", async () => {
    const probe = { isForecastAvailable: vi.fn(async () => false) };
    const resolver = new AigfsRunResolver(
      probe,
      () => new Date("2026-08-30T12:00:00Z").getTime(),
      60_000,
      2,
    );
    const explicit = resolveAigfsRun(
      "2026-08-30T06:00:00Z",
      {
        type: "valid_time",
        validTime: new Date("2026-08-30T12:00:00Z"),
        products: { pressure: true, surface: false },
      },
      resolver,
    );
    expect(explicit).toEqual(new Date("2026-08-30T06:00:00Z"));
    expect(probe.isForecastAvailable).not.toHaveBeenCalled();

    await expect(resolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-08-30T12:00:00Z"),
      endTime: new Date("2026-09-20T00:00:00Z"),
      products: { pressure: true, surface: false },
    })).rejects.toThrow("extends beyond the 384-hour AIGFS horizon");
  });
});


describe("AIGFS guard branches", () => {
  it("rejects malformed runs and non-native forecast hours", () => {
    expect(() => parseAigfsRun("not-a-date")).toThrow("Invalid AIGFS run");
    expect(() => parseAigfsRun("2026-08-30T03:00:00Z")).toThrow("00Z, 06Z, 12Z, or 18Z");
    expect(() => aigfsValidTime(new Date("2026-08-30T00:00:00Z"), -6)).toThrow("0 to 384");
    expect(() => aigfsValidTime(new Date("2026-08-30T00:00:00Z"), 3)).toThrow("every 6");
    expect(() => aigfsValidTime(new Date("2026-08-30T00:00:00Z"), 390)).toThrow("0 to 384");
  });

  it("handles range boundaries and cycle flooring explicitly", () => {
    const run = new Date("2026-08-30T00:00:00Z");
    expect(() => aigfsNativeForecastHoursInRange(
      run,
      new Date("2026-08-30T12:00:00Z"),
      new Date("2026-08-30T06:00:00Z"),
    )).toThrow("endTime must be at or after startTime");
    expect(() => aigfsNativeForecastHoursInRange(
      run,
      new Date("2026-09-20T00:00:00Z"),
      new Date("2026-09-20T06:00:00Z"),
    )).toThrow("No native AIGFS forecast outputs");
    expect(floorToAigfsCycle(new Date("2026-08-30T17:42:12Z")).toISOString())
      .toBe("2026-08-30T12:00:00.000Z");
  });

  it("keeps inventory membership and expansion failures truthful", () => {
    expect(isAigfsPressureLevel(850)).toBe(true);
    expect(isAigfsPressureLevel(750)).toBe(false);
    expect(isAigfsPressureVariable("wind")).toBe(true);
    expect(isAigfsPressureVariable("relative_humidity")).toBe(false);
    expect(isAigfsField("wind_10m")).toBe(true);
    expect(isAigfsField("dew_point_2m")).toBe(false);
    expect(isAigfsAreaField("temperature_2m")).toBe(true);
    expect(isAigfsAreaField("wind_10m")).toBe(false);
    expect(() => expandAigfsRequestedVariables(["relative_humidity"]))
      .toThrow("AIGFS pressure variables not supported");
    expect(() => expandAigfsRequestedFields(["dew_point_2m"]))
      .toThrow("AIGFS fields not supported");
  });

  it("rejects empty cache selections and productless availability probes without transport", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 500 }));
    const cache = new AigfsNomadsSubsetCache(rootDir, fetchFn as typeof fetch, passthroughPolicy);
    await expect(cache.fetch({
      run: new Date("2026-08-30T00:00:00Z"),
      forecastHour: 6,
      variables: [],
      pressureLevelsHpa: [],
      fields: [],
    })).rejects.toThrow("must contain at least one");
    expect(await cache.isForecastAvailable(
      new Date("2026-08-30T00:00:00Z"),
      6,
      { pressure: false, surface: false },
    )).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("treats a missing index as unavailable and propagates non-404 availability errors", async () => {
    const missingFetch = vi.fn(async () => new Response("", { status: 404, statusText: "Not Found" }));
    const missing = new AigfsNomadsSubsetCache(rootDir, missingFetch as typeof fetch, passthroughPolicy);
    expect(await missing.isForecastAvailable(
      new Date("2026-08-30T00:00:00Z"),
      6,
      { pressure: true, surface: false },
    )).toBe(false);

    const failingRoot = join(rootDir, "failing");
    const failingFetch = vi.fn(async () => new Response("", { status: 503, statusText: "Unavailable" }));
    const failing = new AigfsNomadsSubsetCache(failingRoot, failingFetch as typeof fetch, passthroughPolicy);
    await expect(failing.isForecastAvailable(
      new Date("2026-08-30T00:00:00Z"),
      6,
      { pressure: false, surface: true },
    )).rejects.toThrow("availability request failed");
  });

  it("fails latest resolution clearly when no eligible cycle is published", async () => {
    const probe = { isForecastAvailable: vi.fn(async () => false) };
    const resolver = new AigfsRunResolver(
      probe,
      () => new Date("2026-08-30T12:00:00Z").getTime(),
      60_000,
      2,
    );
    await expect(resolver.resolveLatestRun({
      type: "valid_time",
      validTime: new Date("2026-08-30T12:00:00Z"),
      products: { pressure: true, surface: false },
    })).rejects.toThrow("Could not find an AIGFS run");

    await expect(resolver.resolveLatestCompleteRun({
      pressure: true,
      surface: false,
    })).rejects.toThrow("Could not find a complete AIGFS run");
  });

  it("keeps direct service misuse outside the public schema explicit", async () => {
    const fake = new AigfsForecastService({
      cache: { fetch: vi.fn() } as any,
      decoder: { extractPoint: vi.fn() },
      runProvider: {
        resolveLatestRun: vi.fn(),
        resolveLatestCompleteRun: vi.fn(),
      },
    });
    await expect(fake.query({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    } as any)).rejects.toThrow("only accepts dataset=aigfs");
    await expect(fake.diagnose({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-30T06:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
    } as any)).rejects.toThrow("only accepts dataset=aigfs");
    await expect(fake.diagnose({
      dataset: "aigfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-30T06:00:00Z" },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850],
        parcel: "surface_2m",
      },
    } as any)).rejects.toThrow("does not expose parcel diagnostics");
  });
});
