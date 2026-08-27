import { describe, expect, it, vi } from "vitest";
import { AtmosphericAreaSummaryService } from "../src/core/atmospheric-area-summary-service.js";
import { AtmosphericLayerDiagnosticsService } from "../src/core/atmospheric-layer-diagnostics-service.js";
import { AtmosphericParcelDiagnosticsService } from "../src/core/atmospheric-parcel-diagnostics-service.js";
import { LayerDiagnosticsService } from "../src/core/layer-diagnostics.js";
import { ParcelDiagnosticsService } from "../src/core/parcel-diagnostics.js";
import type { ProfileResult } from "../src/core/types.js";
import { AtmosphericBatchPointsService } from "../src/core/atmospheric-batch-points-service.js";
import { AtmosphericPointsTimeSeriesService } from "../src/core/atmospheric-points-timeseries-service.js";
import { AtmosphericTransectService } from "../src/core/atmospheric-transect-service.js";

describe("model-neutral GFS 0.5 geometry dispatch", () => {
  it("injects 0p50 for batch points", async () => {
    const getPoints = vi.fn(async (query: any) => ({ route: "points", query }));
    const service = new AtmosphericBatchPointsService({ gfs: { getPoints } as any });
    const result: any = await service.getPoints({
      model: "gfs_0p50",
      query: {
        points: [{ latitude: 50, longitude: 14 }],
        run: "2026-08-27T00:00:00Z",
        validTime: "2026-08-27T06:00:00Z",
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });
    expect(result.route).toBe("points");
    expect(getPoints).toHaveBeenCalledWith(expect.objectContaining({ grid: "0p50" }));
  });

  it("injects 0p50 for multi-point time series", async () => {
    const getPointsTimeSeries = vi.fn(async (query: any) => ({ route: "points-series", query }));
    const service = new AtmosphericPointsTimeSeriesService({
      gfs: { getPointsTimeSeries } as any,
    });
    const result: any = await service.getPointsTimeSeries({
      model: "gfs_0p50",
      query: {
        points: [{ latitude: 50, longitude: 14 }],
        run: "2026-08-27T00:00:00Z",
        startTime: "2026-08-27T00:00:00Z",
        endTime: "2026-08-27T06:00:00Z",
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });
    expect(result.route).toBe("points-series");
    expect(getPointsTimeSeries).toHaveBeenCalledWith(
      expect.objectContaining({ grid: "0p50" }),
    );
  });

  it("injects 0p50 for transects", async () => {
    const getTransect = vi.fn(async (query: any) => ({ route: "transect", query }));
    const service = new AtmosphericTransectService({ gfs: { getTransect } as any });
    const result: any = await service.getTransect({
      model: "gfs_0p50",
      query: {
        start: { latitude: 49.5, longitude: 14 },
        end: { latitude: 50, longitude: 15 },
        run: "2026-08-27T00:00:00Z",
        validTime: "2026-08-27T06:00:00Z",
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });
    expect(result.route).toBe("transect");
    expect(getTransect).toHaveBeenCalledWith(expect.objectContaining({ grid: "0p50" }));
  });

  it("injects 0p50 for area summaries", async () => {
    const summarize = vi.fn(async (query: any) => ({ route: "area", query }));
    const service = new AtmosphericAreaSummaryService({ gfs: { summarize } as any });
    const result: any = await service.summarize({
      model: "gfs_0p50",
      query: {
        westLongitude: 13.5,
        eastLongitude: 14.5,
        southLatitude: 49.5,
        northLatitude: 50.5,
        run: "2026-08-27T00:00:00Z",
        validTime: "2026-08-27T06:00:00Z",
        variable: "temperature",
        pressureLevelHpa: 850,
      },
    });
    expect(result.route).toBe("area");
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({ grid: "0p50" }));
  });
});

describe("model-neutral GFS 0.5 diagnostic dispatch", () => {
  const run = "2026-08-23T06:00:00.000Z";
  const validTime = "2026-08-23T12:00:00.000Z";
  const requestedPoint = { latitude: 50.08, longitude: 14.43 };
  const gridPoint = { latitude: 50, longitude: 14.5 };

  it("forces 0p50 through layer diagnostics into the shared profile core", async () => {
    let seenGrid: unknown;
    const profile: ProfileResult = {
      model: "gfs_0p50",
      run,
      validTime,
      forecastHour: 6,
      requestedPoint,
      gridPoint,
      levels: [
        { pressureHpa: 850, temperatureC: 12, geopotentialHeightGpm: 1500, uWindMs: 3, vWindMs: 4 },
        { pressureHpa: 700, temperatureC: 0, geopotentialHeightGpm: 3000, uWindMs: -10, vWindMs: 0 },
      ],
      source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", cacheHit: true },
    };
    const core = new LayerDiagnosticsService({
      profileGetter: {
        getProfile: async (query) => {
          seenGrid = query.grid;
          return profile;
        },
      },
    });
    const service = new AtmosphericLayerDiagnosticsService({ gfs: core });

    const result = await service.getLayerDiagnostics({
      model: "gfs_0p50",
      query: {
        ...requestedPoint,
        run,
        validTime,
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
        source: "s3",
      },
    });
    expect(seenGrid).toBe("0p50");
    expect(result.model).toBe("gfs_0p50");
  });

  it("forces 0p50 through parcel diagnostics into the shared profile core", async () => {
    let seenGrid: unknown;
    const levels = [
      { pressureHpa: 950, geopotentialHeightGpm: 550, temperatureC: 27, specificHumidityKgKg: 0.015 },
      { pressureHpa: 900, geopotentialHeightGpm: 1000, temperatureC: 23, specificHumidityKgKg: 0.012 },
      { pressureHpa: 850, geopotentialHeightGpm: 1500, temperatureC: 14, specificHumidityKgKg: 0.009 },
      { pressureHpa: 800, geopotentialHeightGpm: 2000, temperatureC: 9, specificHumidityKgKg: 0.007 },
      { pressureHpa: 700, geopotentialHeightGpm: 3000, temperatureC: 0, specificHumidityKgKg: 0.004 },
      { pressureHpa: 600, geopotentialHeightGpm: 4200, temperatureC: -10, specificHumidityKgKg: 0.002 },
      { pressureHpa: 500, geopotentialHeightGpm: 5600, temperatureC: -22, specificHumidityKgKg: 0.001 },
      { pressureHpa: 400, geopotentialHeightGpm: 7200, temperatureC: -32, specificHumidityKgKg: 0.0006 },
      { pressureHpa: 300, geopotentialHeightGpm: 9200, temperatureC: -38, specificHumidityKgKg: 0.0003 },
      { pressureHpa: 250, geopotentialHeightGpm: 10400, temperatureC: -25, specificHumidityKgKg: 0.0002 },
    ];
    const profile: ProfileResult = {
      model: "gfs_0p50",
      run,
      validTime,
      forecastHour: 6,
      requestedPoint,
      gridPoint,
      levels,
      fields: [
        { id: "surface_pressure", level: { type: "surface" }, temporal: { type: "instantaneous" }, values: { pressurePa: 100000 } },
        { id: "surface_geopotential_height", level: { type: "surface" }, temporal: { type: "instantaneous" }, values: { geopotentialHeightGpm: 100 } },
        { id: "temperature_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { temperatureC: 30 } },
        { id: "specific_humidity_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { specificHumidityKgKg: 0.018 } },
      ],
      source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", cacheHit: true },
    };
    const core = new ParcelDiagnosticsService({
      profileGetter: {
        getProfile: async (query) => {
          seenGrid = query.grid;
          return profile;
        },
      },
    });
    const service = new AtmosphericParcelDiagnosticsService({ gfs: core });

    const result = await service.getParcelDiagnostics({
      model: "gfs_0p50",
      query: {
        ...requestedPoint,
        run,
        validTime,
        pressureLevelsHpa: levels.map((level) => level.pressureHpa),
        parcel: "surface_2m",
        source: "s3",
      },
    });
    expect(seenGrid).toBe("0p50");
    expect(result.model).toBe("gfs_0p50");
    expect(result.parcel.capeJkg).toBeGreaterThan(0);
  });
});
