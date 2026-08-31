import { describe, expect, it, vi } from "vitest";
import { AifsForecastService } from "../src/core/aifs.js";
import {
  AIFS_MAX_FORECAST_HOUR,
  aifsForecastHour,
  aifsForecastHoursInRange,
  aifsValidTime,
  latestAifsCycleAtOrBefore,
  parseAifsRun,
  previousAifsCycle,
} from "../src/core/aifs-time.js";
import {
  AifsOpenDataRunProbe,
  buildAifsOpenDataForecastIndexUrl,
  buildAifsOpenDataForecastUrl,
} from "../src/sources/aifs-open-data.js";
import { AifsLatestRunResolver } from "../src/core/aifs-run.js";
import {
  isSupportedAifsPressureSelection,
} from "../src/catalog/aifs.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";
import type { DecodedValue } from "../src/core/types.js";

const run = new Date("2026-08-31T00:00:00Z");
const gridPoint = { latitude: 50, longitude: 14.5 };

describe("ECMWF AIFS source semantics", () => {
  it("builds AIFS Single 0.25 degree operational Open Data paths", () => {
    expect(buildAifsOpenDataForecastUrl(run, 6)).toBe(
      "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20260831/00z/aifs-single/0p25/oper/20260831000000-6h-oper-fc.grib2",
    );
    expect(buildAifsOpenDataForecastIndexUrl(run, 360)).toBe(
      "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20260831/00z/aifs-single/0p25/oper/20260831000000-360h-oper-fc.index",
    );
  });

  it("preserves four daily cycles and native 6-hour output through f360", () => {
    expect(AIFS_MAX_FORECAST_HOUR).toBe(360);
    expect(parseAifsRun("2026-08-31T18:00:00Z").toISOString())
      .toBe("2026-08-31T18:00:00.000Z");
    expect(() => parseAifsRun("2026-08-31T09:00:00Z")).toThrow("00/06/12/18");
    expect(aifsForecastHour(run, new Date("2026-08-31T12:00:00Z"))).toBe(12);
    expect(() => aifsForecastHour(run, new Date("2026-08-31T03:00:00Z")))
      .toThrow("native cadence is 6-hourly");
    expect(aifsForecastHoursInRange(
      run,
      new Date("2026-08-31T03:00:00Z"),
      new Date("2026-08-31T18:00:00Z"),
    )).toEqual([6, 12, 18]);
  });

  it("rejects invalid temporal requests and handles cycle arithmetic", () => {
    expect(() => parseAifsRun("not-a-date")).toThrow("Invalid AIFS run");
    expect(() => parseAifsRun("2026-08-31T12:30:00Z")).toThrow("00/06/12/18");
    expect(() => aifsForecastHour(run, new Date("2026-08-30T18:00:00Z")))
      .toThrow("at or after the run");
    expect(() => aifsForecastHour(run, new Date("2026-09-15T06:00:00Z")))
      .toThrow("native cadence is 6-hourly");
    expect(() => aifsForecastHoursInRange(
      run,
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-08-31T00:00:00Z"),
    )).toThrow("end time");
    expect(() => aifsForecastHoursInRange(
      run,
      new Date("2026-09-16T00:00:00Z"),
      new Date("2026-09-16T06:00:00Z"),
    )).toThrow("contains no native");
    expect(() => aifsValidTime(run, 3)).toThrow("not a native");
    expect(latestAifsCycleAtOrBefore(new Date("2026-08-31T17:59:00Z")).toISOString())
      .toBe("2026-08-31T12:00:00.000Z");
    expect(previousAifsCycle(new Date("2026-08-31T12:00:00Z"), 2).toISOString())
      .toBe("2026-08-31T00:00:00.000Z");
  });
});

describe("AIFS availability and latest-run resolution", () => {
  const selectors = [
    { key: "temperature@850", param: "t", levtype: "pl" as const, levelist: 850 },
  ];

  it("fails over between ECMWF Open Data mirrors and checks selected inventory", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("ecmwf-forecasts.s3.eu-central-1.amazonaws.com")) {
        return new Response("", { status: 404 });
      }
      return new Response(
        '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","_offset":0,"_length":10}',
        { status: 200 },
      );
    }) as typeof fetch;

    await expect(new AifsOpenDataRunProbe(fetchFn).isForecastAvailable(
      run,
      6,
      selectors,
    )).resolves.toBe(true);
    expect(fetchFn.mock.calls.some(([input]) =>
      String(input).includes("storage.googleapis.com/ecmwf-open-data"))).toBe(true);
  });

  it("treats missing objects or selected fields as unavailable and rejects hard HTTP failures", async () => {
    const notFound = new AifsOpenDataRunProbe(
      vi.fn(async () => new Response("", { status: 404 })) as typeof fetch,
    );
    await expect(notFound.isForecastAvailable(run, 6, selectors)).resolves.toBe(false);

    const wrongInventory = new AifsOpenDataRunProbe(
      vi.fn(async () => new Response(
        '{"date":"20260831","time":"0000","step":"6","levtype":"sfc","param":"2t","_offset":0,"_length":10}',
        { status: 200 },
      )) as typeof fetch,
    );
    await expect(wrongInventory.isForecastAvailable(run, 6, selectors)).resolves.toBe(false);

    const badRequest = new AifsOpenDataRunProbe(
      vi.fn(async () => new Response("bad", { status: 400, statusText: "Bad Request" })) as typeof fetch,
    );
    await expect(badRequest.isForecastAvailable(run, 6, selectors))
      .rejects.toThrow("HTTP 400");
  });

  it("selects the newest published native cycle for points and ranges", async () => {
    const isForecastAvailable = vi.fn(async (candidate: Date) =>
      candidate.toISOString() === "2026-08-31T12:00:00.000Z");
    const resolver = new AifsLatestRunResolver({
      probe: { isForecastAvailable },
      now: () => new Date("2026-08-31T19:00:00Z"),
    });

    await expect(resolver.resolveLatestRun(
      new Date("2026-08-31T18:00:00Z"),
      selectors,
    )).resolves.toEqual(new Date("2026-08-31T12:00:00Z"));
    expect(isForecastAvailable).toHaveBeenCalledWith(
      new Date("2026-08-31T18:00:00Z"),
      0,
      selectors,
    );
    expect(isForecastAvailable).toHaveBeenCalledWith(
      new Date("2026-08-31T12:00:00Z"),
      6,
      selectors,
    );

    isForecastAvailable.mockClear();
    isForecastAvailable.mockResolvedValue(true);
    await expect(resolver.resolveLatestRunForRange(
      new Date("2026-08-31T12:00:00Z"),
      new Date("2026-08-31T18:00:00Z"),
      selectors,
    )).resolves.toEqual(new Date("2026-08-31T12:00:00Z"));
    expect(isForecastAvailable).toHaveBeenCalledWith(
      new Date("2026-08-31T12:00:00Z"),
      6,
      selectors,
    );
  });

  it("fails cleanly when no candidate cycle can satisfy the selection or range", async () => {
    const resolver = new AifsLatestRunResolver({
      probe: { isForecastAvailable: vi.fn(async () => false) },
      now: () => new Date("2026-08-31T19:00:00Z"),
      maxCandidates: 2,
    });

    await expect(resolver.resolveLatestRun(
      new Date("2026-08-31T18:00:00Z"),
      selectors,
    )).rejects.toThrow("No published ECMWF AIFS cycle");

    await expect(resolver.resolveLatestRunForRange(
      new Date("2026-08-31T18:00:00Z"),
      new Date("2026-09-20T00:00:00Z"),
      selectors,
    )).rejects.toThrow("No published ECMWF AIFS cycle");
  });

  it("encodes the v2 moisture ceiling separately from the common pressure-level vocabulary", () => {
    expect(isSupportedAifsPressureSelection("temperature", 10)).toBe(true);
    expect(isSupportedAifsPressureSelection("vertical_velocity", 10)).toBe(true);
    expect(isSupportedAifsPressureSelection("specific_humidity", 50)).toBe(true);
    expect(isSupportedAifsPressureSelection("specific_humidity", 10)).toBe(false);
    expect(isSupportedAifsPressureSelection("air_density", 10)).toBe(false);
  });
});

describe("AIFS unified capability", () => {
  it("rejects pressure inventory that AIFS Single does not publish", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T12:00:00Z" },
      selection: {
        variables: ["relative_humidity"],
        pressureLevelsHpa: [850],
      },
    })).toThrow("AIFS pressure variables not supported");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T12:00:00Z" },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [825],
      },
    })).toThrow("AIFS pressure levels not supported");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T12:00:00Z" },
      selection: {
        variables: ["specific_humidity"],
        pressureLevelsHpa: [10],
      },
    })).toThrow("specific_humidity@10hPa");
  });

  it("uses the same AIFS selection path for time series, multi-point and transect queries", async () => {
    const fetchSelection = vi.fn(async () => ({ path: "aifs-temperature", cacheHit: true }));
    const decoder = {
      engine: "gribberish" as const,
      extractPoint: vi.fn(async (_path: string, longitude: number, latitude: number) => [
        {
          code: "t",
          pressureHpa: 850,
          value: 280,
          gridPoint: { latitude, longitude },
        },
      ] satisfies DecodedValue[]),
    };
    const service = new AifsForecastService({
      source: { fetchSelection },
      decoder,
    });

    const series: any = await service.query(queryAtmosphereSchema.parse({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: {
        from: "2026-08-31T00:00:00Z",
        to: "2026-08-31T12:00:00Z",
      },
      forecast: { run: "2026-08-31T00:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    }));
    expect(series.series.map((step: any) => step.forecastHour)).toEqual([0, 6, 12]);
    expect(series.series.every((step: any) => step.cacheHit)).toBe(true);

    const points: any = await service.query(queryAtmosphereSchema.parse({
      dataset: "aifs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50, longitude: 14 },
          { latitude: 49, longitude: 15 },
        ],
      },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "2026-08-31T00:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    }));
    expect(points.points).toHaveLength(2);
    expect(points.points[1].gridPoint).toEqual({ latitude: 49, longitude: 15 });

    const transect: any = await service.query(queryAtmosphereSchema.parse({
      dataset: "aifs",
      geometry: {
        type: "transect",
        start: { latitude: 50, longitude: 14 },
        end: { latitude: 49, longitude: 15 },
        samples: 3,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "2026-08-31T00:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    }));
    expect(transect.samples).toHaveLength(3);
    expect(transect.samples[0].distanceKm).toBe(0);
    expect(transect.samples[2].distanceKm).toBeCloseTo(transect.totalDistanceKm);
    expect(fetchSelection).toHaveBeenCalledTimes(5);
  });

  it("enforces AIFS service capability and request-size boundaries before data access", async () => {
    const fetchSelection = vi.fn(async () => {
      throw new Error("network should not be reached");
    });
    const service = new AifsForecastService({
      source: { fetchSelection },
      decoder: {
        engine: "gribberish",
        extractPoint: vi.fn(async () => []),
      },
    });

    await expect(service.query({
      dataset: "gfs",
    } as any)).rejects.toThrow("only accepts dataset=aifs");

    await expect(service.diagnose({
      dataset: "gfs",
    } as any)).rejects.toThrow("only accepts dataset=aifs");

    await expect(service.diagnose({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "2026-08-31T00:00:00Z" },
      diagnostic: {
        kind: "parcel",
        parcel: "surface",
      },
    } as any)).rejects.toThrow("parcel diagnostics are not exposed");

    await expect(service.query({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "latest_complete" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    } as any)).rejects.toThrow("does not expose latest_complete");

    await expect(service.query({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: {
        from: "2026-08-31T00:00:00Z",
        to: "2026-08-31T18:00:00Z",
        maxSteps: 2,
      },
      forecast: { run: "2026-08-31T00:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    } as any)).rejects.toThrow("exceeding maxSteps=2");

    await expect(service.query({
      dataset: "aifs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50, longitude: 14 },
          { latitude: 49, longitude: 15 },
        ],
      },
      time: {
        from: "2026-08-31T00:00:00Z",
        to: "2026-08-31T12:00:00Z",
      },
      limits: { maxPointSteps: 5 },
      forecast: { run: "2026-08-31T00:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    } as any)).rejects.toThrow("exceeding maxPointSteps=5");

    await expect(service.query({
      dataset: "aifs",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 15,
        southLatitude: 49,
        northLatitude: 51,
      },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "2026-08-31T00:00:00Z" },
      selection: {
        variables: ["wind"],
        pressureLevelsHpa: [850],
      },
    } as any)).rejects.toThrow("one raw pressure variable");

    expect(fetchSelection).not.toHaveBeenCalled();
  });

  it("supports successful point-matrix queries and selection-aware latest run injection", async () => {
    const selections = new Map<string, readonly any[]>();
    let fileIndex = 0;
    const fetchSelection = vi.fn(async (request: any) => {
      const path = `aifs-matrix-${fileIndex++}`;
      selections.set(path, request.selectors);
      return { path, cacheHit: fileIndex % 2 === 0 };
    });
    const decoder = {
      engine: "gribberish" as const,
      extractPoint: vi.fn(async (path: string, longitude: number, latitude: number) =>
        (selections.get(path) ?? []).map((selector: any) => ({
          code: selector.param,
          pressureHpa: selector.levelist,
          value: aifsFixtureValue(selector.param, selector.levelist),
          gridPoint: { latitude, longitude },
        })) satisfies DecodedValue[]),
    };
    const latestRunProvider = {
      resolveLatestRun: vi.fn(async () => run),
      resolveLatestRunForRange: vi.fn(async () => run),
    };
    const service = new AifsForecastService({
      source: { fetchSelection },
      decoder,
      latestRunProvider,
    });

    const point: any = await service.query({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "latest" },
      selection: {
        variables: ["temperature", "wind", "specific_humidity"],
        pressureLevelsHpa: [850],
        fields: [
          "temperature_2m",
          "relative_humidity_2m",
          "specific_humidity_2m",
          "surface_geopotential_height",
          "wind_100m",
          "low_cloud_cover",
        ],
      },
    } as any);
    expect(latestRunProvider.resolveLatestRun).toHaveBeenCalled();
    expect(point.fields.find((field: any) => field.id === "specific_humidity_2m")
      .values.specificHumidityKgKg).toBeGreaterThan(0);
    expect(point.fields.find((field: any) => field.id === "surface_geopotential_height")
      .values.surfaceGeopotentialHeightGpm).toBeCloseTo(100);
    expect(point.fields.find((field: any) => field.id === "wind_100m")
      .values.windSpeedMs).toBe(10);
    expect(point.fields.find((field: any) => field.id === "low_cloud_cover")
      .values.lowCloudCoverPct).toBeCloseTo(20);

    const matrix: any = await service.query({
      dataset: "aifs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50, longitude: 14 },
          { latitude: 49.5, longitude: 14.5 },
        ],
      },
      time: {
        from: "2026-08-31T00:00:00Z",
        to: "2026-08-31T06:00:00Z",
      },
      forecast: { run: "latest" },
      limits: { maxPointSteps: 10 },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    } as any);
    expect(latestRunProvider.resolveLatestRunForRange).toHaveBeenCalled();
    expect(matrix.series).toHaveLength(2);
    expect(matrix.series[0].points).toHaveLength(2);
    expect(matrix.series[1].forecastHour).toBe(6);
  });

  it("derives AIFS layer, profile and diagnostic-time-series products", async () => {
    const selections = new Map<string, readonly any[]>();
    let fileIndex = 0;
    const fetchSelection = vi.fn(async (request: any) => {
      const path = `aifs-diagnostic-${fileIndex++}`;
      selections.set(path, request.selectors);
      return { path, cacheHit: true };
    });
    const decoder = {
      engine: "gribberish" as const,
      extractPoint: vi.fn(async (path: string, longitude: number, latitude: number) =>
        (selections.get(path) ?? []).map((selector: any) => ({
          code: selector.param,
          pressureHpa: selector.levelist,
          value: aifsFixtureValue(selector.param, selector.levelist),
          gridPoint: { latitude, longitude },
        })) satisfies DecodedValue[]),
    };
    const service = new AifsForecastService({
      source: { fetchSelection },
      decoder,
    });

    const layer: any = await service.diagnose({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "2026-08-31T00:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: [
          "temperature_lapse_rate",
          "wind_shear",
          "potential_temperature_gradient",
        ],
      },
    } as any);
    expect(layer.diagnostics.temperature_lapse_rate.temperatureLapseRateCPerKm)
      .toBeGreaterThan(0);
    expect(layer.diagnostics.wind_shear.windShearMagnitudeMs).toBeGreaterThan(0);

    const profile: any = await service.diagnose({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "2026-08-31T00:00:00Z" },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700, 500],
        diagnostics: [
          "freezing_level_crossings",
          "temperature_inversion_layers",
        ],
      },
    } as any);
    expect(profile.diagnostics.freezing_level_crossings.crossings.length).toBeGreaterThan(0);
    expect(profile.diagnostics.temperature_inversion_layers.layers.length).toBeGreaterThan(0);

    const series: any = await service.diagnose({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: {
        from: "2026-08-31T00:00:00Z",
        to: "2026-08-31T12:00:00Z",
        maxSteps: 3,
      },
      forecast: { run: "2026-08-31T00:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
    } as any);
    expect(series.series).toHaveLength(3);
    expect(series.series.every((step: any) => step.kind === "layer")).toBe(true);
    expect(series.series.every((step: any) => step.cacheHit)).toBe(true);
  });

  it("rejects unsupported AIFS selections directly in the service layer", async () => {
    const service = new AifsForecastService({
      source: {
        fetchSelection: vi.fn(async () => {
          throw new Error("network should not be reached");
        }),
      },
      decoder: {
        engine: "gribberish",
        extractPoint: vi.fn(async () => []),
      },
    });
    const base = {
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "2026-08-31T00:00:00Z" },
    };

    await expect(service.query({
      ...base,
      selection: { variables: ["relative_humidity"], pressureLevelsHpa: [850] },
    } as any)).rejects.toThrow("pressure variables not supported");
    await expect(service.query({
      ...base,
      selection: { variables: ["temperature"], pressureLevelsHpa: [825] },
    } as any)).rejects.toThrow("pressure levels not supported");
    await expect(service.query({
      ...base,
      selection: { variables: ["specific_humidity"], pressureLevelsHpa: [10] },
    } as any)).rejects.toThrow("specific_humidity@10hPa");
    await expect(service.query({
      ...base,
      selection: { fields: ["precipitable_water"] },
    } as any)).rejects.toThrow("fields not supported");
  });

  it("normalizes AIFS pressure and surface state while preserving provenance", async () => {
    const fetchSelection = vi.fn(async () => ({ path: "aifs-fixture", cacheHit: false }));
    const values: DecodedValue[] = [
      { code: "t", pressureHpa: 850, value: 280, gridPoint },
      { code: "u", pressureHpa: 850, value: 3, gridPoint },
      { code: "v", pressureHpa: 850, value: 4, gridPoint },
      { code: "z", pressureHpa: 850, value: 14_709.975, gridPoint },
      { code: "q", pressureHpa: 850, value: 0.005, gridPoint },
      { code: "2t", heightAboveGroundM: 2, value: 293.15, gridPoint },
      { code: "10u", heightAboveGroundM: 10, value: 6, gridPoint },
      { code: "10v", heightAboveGroundM: 10, value: 8, gridPoint },
      { code: "tp", surface: true, value: 0.012, gridPoint },
      { code: "2d", heightAboveGroundM: 2, value: 283.15, gridPoint },
    ];
    const service = new AifsForecastService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractPoint: vi.fn(async () => values) },
    });

    const result: any = await service.query(queryAtmosphereSchema.parse({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "2026-08-31T00:00:00Z" },
      selection: {
        variables: ["temperature", "wind", "geopotential_height", "specific_humidity"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m", "wind_10m", "total_precipitation", "relative_humidity_2m"],
      },
    }));

    expect(fetchSelection.mock.calls[0]?.[0].selectors.map((selector: any) => selector.param))
      .toEqual(["t", "u", "v", "z", "q", "2t", "10u", "10v", "tp", "2d"]);
    expect(result.model).toBe("aifs_0p25");
    expect(result.forecastHour).toBe(6);
    expect(result.levels[0]).toMatchObject({
      pressureHpa: 850,
      uWindMs: 3,
      vWindMs: 4,
      windSpeedMs: 5,
      specificHumidityKgKg: 0.005,
    });
    expect(result.levels[0].temperatureC).toBeCloseTo(6.85);
    expect(result.levels[0].geopotentialHeightGpm).toBeCloseTo(1500, 8);
    expect(result.fields.find((field: any) => field.id === "temperature_2m")
      .values.temperatureC).toBeCloseTo(20);
    expect(result.fields.find((field: any) => field.id === "wind_10m")
      .values.windSpeedMs).toBe(10);
    expect(result.fields.find((field: any) => field.id === "total_precipitation"))
      .toMatchObject({
        temporal: { type: "accumulation", startForecastHour: 0, endForecastHour: 6 },
        values: { totalPrecipitationMm: 12 },
      });
    expect(result.fields.find((field: any) => field.id === "relative_humidity_2m")
      .values.relativeHumidityPct).toBeGreaterThan(40);
    expect(result.source).toMatchObject({
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      product: "aifs_single_0p25_oper_fc",
      horizontalGridDegrees: 0.25,
      cacheHit: false,
    });
  });
});


function aifsFixtureValue(param: string, pressureHpa?: number): number {
  if (param === "t") {
    if (pressureHpa === 850) return 278.15;
    if (pressureHpa === 700) return 268.15;
    if (pressureHpa === 500) return 275.15;
    return 280;
  }
  if (param === "z") {
    if (pressureHpa === 850) return 1_500 * 9.80665;
    if (pressureHpa === 700) return 3_000 * 9.80665;
    if (pressureHpa === 500) return 5_600 * 9.80665;
    return 100 * 9.80665;
  }
  if (param === "u") {
    if (pressureHpa === 850) return 2;
    if (pressureHpa === 700) return 5;
    if (pressureHpa === 500) return 10;
    return 3;
  }
  if (param === "v") {
    if (pressureHpa === 850) return 1;
    if (pressureHpa === 700) return 3;
    if (pressureHpa === 500) return 7;
    return 4;
  }
  if (param === "q") return 0.005;
  if (param === "w") return 0.1;
  if (param === "2t") return 293.15;
  if (param === "2d") return 283.15;
  if (param === "sp") return 100_000;
  if (param === "msl") return 101_325;
  if (param === "10u") return 3;
  if (param === "10v") return 4;
  if (param === "100u") return 6;
  if (param === "100v") return 8;
  if (param === "tp") return 0.012;
  if (param === "lcc") return 0.2;
  if (param === "mcc") return 0.3;
  if (param === "hcc") return 0.4;
  if (param === "tcc") return 0.5;
  throw new Error(`Unhandled AIFS fixture parameter: ${param}`);
}
