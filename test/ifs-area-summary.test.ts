import { describe, expect, it, vi } from "vitest";
import { IfsAreaSummaryService, estimateIfsGridPoints } from "../src/core/ifs-area-summary.js";

const run = new Date("2026-08-28T00:00:00Z");
const box = {
  westLongitude: 14,
  eastLongitude: 14.5,
  southLatitude: 49.75,
  northLatitude: 50.25,
};
const rawPoints = [
  { latitude: 50, longitude: 14, value: 283.15 },
  { latitude: 50, longitude: 14.25, value: 285.15 },
  { latitude: 50, longitude: 14.5, value: 287.15 },
];

describe("IFS area summary", () => {
  it("summarizes a pressure variable with shared distribution semantics", async () => {
    const fetchSelection = vi.fn(async () => ({ path: "temperature.grib2", cacheHit: false }));
    const resolveLatestRun = vi.fn(async () => run);
    const extractBox = vi.fn(async () => rawPoints);
    const service = new IfsAreaSummaryService({
      source: { fetchSelection },
      latestRunProvider: { resolveLatestRun },
      decoder: { engine: "gribberish", extractBox },
    });

    const result = await service.summarize({
      ...box,
      run: "latest",
      validTime: "2026-08-28T06:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      percentiles: [50],
      thresholds: [{ operator: "gte", value: 12 }],
      includeExtremaLocations: true,
    });

    expect(resolveLatestRun).toHaveBeenCalledWith(
      new Date("2026-08-28T06:00:00Z"),
      [expect.objectContaining({ param: "t", levtype: "pl", levelist: 850 })],
    );
    expect(fetchSelection).toHaveBeenCalledWith({
      run,
      forecastHour: 6,
      selectors: [expect.objectContaining({ param: "t", levtype: "pl", levelist: 850 })],
    });
    expect(result.variable).toMatchObject({
      id: "temperature",
      pressureHpa: 850,
      unit: "degC",
    });
    expect(result.statistics).toMatchObject({
      definedGridPoints: 3,
      mean: 12,
      min: 10,
      max: 14,
      meanKind: "unweighted_grid_point_mean",
    });
    expect(result.distribution?.percentiles).toEqual([{ percentile: 50, value: 12 }]);
    expect(result.distribution?.thresholdFractions?.[0]).toMatchObject({
      threshold: 12,
      matchingGridPoints: 2,
      fraction: 2 / 3,
    });
    expect(result.distribution?.extrema?.min.gridPoint).toEqual({ latitude: 50, longitude: 14 });
    expect(result.source).toMatchObject({
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      horizontalGridDegrees: 0.25,
      cacheHit: false,
    });
  });

  it("normalizes ECMWF relative vorticity to canonical absolute vorticity per grid latitude", async () => {
    const fetchSelection = vi.fn(async () => ({ path: "vo.grib2", cacheHit: true }));
    const extractBox = vi.fn(async () => [
      { latitude: 0, longitude: 14, value: 1e-5 },
      { latitude: 50, longitude: 14.25, value: 1e-5 },
    ]);
    const service = new IfsAreaSummaryService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractBox },
    });

    const result = await service.summarize({
      ...box,
      run: run.toISOString(),
      validTime: "2026-08-28T06:00:00Z",
      variable: "absolute_vorticity",
      pressureLevelHpa: 850,
    });

    expect(fetchSelection).toHaveBeenCalledWith({
      run,
      forecastHour: 6,
      selectors: [expect.objectContaining({ param: "vo", levtype: "pl", levelist: 850 })],
    });
    const coriolis50 = 2 * 7.292115e-5 * Math.sin(50 * Math.PI / 180);
    expect(result.statistics.min).toBeCloseTo(1e-5, 10);
    expect(result.statistics.max).toBeCloseTo(1e-5 + coriolis50, 10);
    expect(result.variable?.id).toBe("absolute_vorticity");
  });

  it("fetches run-static surface geopotential from f000 and normalizes to gpm", async () => {
    const fetchSelection = vi.fn(async () => ({ path: "z.grib2", cacheHit: true }));
    const extractBox = vi.fn(async () => rawPoints.map((point, index) => ({
      ...point,
      value: (100 + index * 10) * 9.80665,
    })));
    const service = new IfsAreaSummaryService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractBox },
    });

    const result = await service.summarize({
      ...box,
      run: run.toISOString(),
      validTime: "2026-08-28T06:00:00Z",
      field: "surface_geopotential_height",
    });

    expect(fetchSelection).toHaveBeenCalledWith({
      run,
      forecastHour: 0,
      selectors: [expect.objectContaining({
        param: "z",
        levtype: "sfc",
        sourceForecastHour: 0,
      })],
    });
    expect(result.forecastHour).toBe(6);
    expect(result.statistics.mean).toBeCloseTo(110, 8);
    expect(result.field).toMatchObject({
      id: "surface_geopotential_height",
      temporal: { type: "instantaneous" },
      output: { unit: "gpm" },
    });
  });

  it("normalizes accumulated precipitation and guards area size", async () => {
    const fetchSelection = vi.fn(async () => ({ path: "tp.grib2", cacheHit: true }));
    const extractBox = vi.fn(async () => rawPoints.map((point, index) => ({
      ...point,
      value: 0.001 * (index + 1),
    })));
    const service = new IfsAreaSummaryService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractBox },
    });
    const result = await service.summarize({
      ...box,
      run: run.toISOString(),
      validTime: "2026-08-28T06:00:00Z",
      field: "total_precipitation",
    });
    expect(result.statistics.mean).toBeCloseTo(2, 8);
    expect(result.field?.temporal).toEqual({
      type: "accumulation",
      startForecastHour: 0,
      endForecastHour: 6,
      startTime: "2026-08-28T00:00:00.000Z",
      endTime: "2026-08-28T06:00:00.000Z",
    });

    await expect(service.summarize({
      westLongitude: 0,
      eastLongitude: 10,
      southLatitude: 40,
      northLatitude: 50,
      run: run.toISOString(),
      validTime: "2026-08-28T06:00:00Z",
      field: "surface_pressure",
      maxGridPoints: 10,
    })).rejects.toThrow("exceeding maxGridPoints=10");
  });

  it("normalizes raw 2 m temperature and cloud-fraction fields before aggregation", async () => {
    const fetchSelection = vi.fn(async ({ selectors }: any) => ({
      path: selectors[0].param,
      cacheHit: true,
    }));
    const extractBox = vi.fn(async (path: string) => path === "2t"
      ? [{ latitude: 50, longitude: 14, value: 293.15 }]
      : [{ latitude: 50, longitude: 14, value: 0.625 }]);
    const service = new IfsAreaSummaryService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractBox },
    });

    const temperature = await service.summarize({
      ...box,
      run: run.toISOString(),
      validTime: run.toISOString(),
      field: "temperature_2m",
    });
    expect(temperature.statistics.mean).toBeCloseTo(20, 8);
    expect(temperature.field?.level).toEqual({ type: "height_above_ground_m", heightM: 2 });

    const cloud = await service.summarize({
      ...box,
      run: run.toISOString(),
      validTime: run.toISOString(),
      field: "total_atmosphere_cloud_cover",
    });
    expect(cloud.statistics.mean).toBeCloseTo(62.5, 8);
    expect(cloud.field?.level).toEqual({ type: "named_layer", id: "entire_atmosphere" });
  });

  it("validates IFS area selection and bbox invariants", async () => {
    const service = new IfsAreaSummaryService({
      source: { fetchSelection: vi.fn() },
      decoder: { engine: "gribberish", extractBox: vi.fn() },
    });

    await expect(service.summarize({
      ...box,
      run: run.toISOString(),
      validTime: run.toISOString(),
      variable: "temperature",
      pressureLevelHpa: 850,
      field: "temperature_2m",
    } as any)).rejects.toThrow("either one raw pressure variable or one raw field");

    await expect(service.summarize({
      ...box,
      run: run.toISOString(),
      validTime: run.toISOString(),
      pressureLevelHpa: 850,
    } as any)).rejects.toThrow("requires variable");

    await expect(service.summarize({
      ...box,
      run: run.toISOString(),
      validTime: run.toISOString(),
      variable: "temperature",
    } as any)).rejects.toThrow("requires pressureLevelHpa");

    await expect(service.summarize({
      ...box,
      eastLongitude: box.westLongitude,
      run: run.toISOString(),
      validTime: run.toISOString(),
      field: "surface_pressure",
    })).rejects.toThrow("eastLongitude must be greater");

    await expect(service.summarize({
      ...box,
      northLatitude: box.southLatitude,
      run: run.toISOString(),
      validTime: run.toISOString(),
      field: "surface_pressure",
    })).rejects.toThrow("northLatitude must be greater");

    await expect(service.summarize({
      ...box,
      run: run.toISOString(),
      validTime: run.toISOString(),
      field: "surface_pressure",
      percentiles: [50, 50],
    })).rejects.toThrow("Area percentiles must be unique");
  });

  it("uses the deterministic 0.25 degree grid estimate", () => {
    expect(estimateIfsGridPoints(box)).toBe(16);
  });
});
