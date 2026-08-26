import { describe, expect, it, vi } from "vitest";
import { AtmosphericDiagnosticTimeSeriesService } from "../src/core/atmospheric-diagnostic-timeseries-service.js";
import type { DiagnosticTimeSeriesResult } from "../src/schema/diagnostic-time-series-result.js";
import type { GefsDiagnosticTimeSeriesResult } from "../src/schema/gefs-diagnostic-timeseries.js";
import type { HistoricalDiagnosticTimeSeriesResult } from "../src/schema/history-diagnostic-timeseries.js";

const gfsResult: DiagnosticTimeSeriesResult = {
  model: "gfs_0p25",
  run: "2026-08-23T12:00:00Z",
  requestedStartTime: "2026-08-23T15:00:00Z",
  requestedEndTime: "2026-08-23T18:00:00Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2" },
  diagnostic: {
    kind: "layer",
    lowerPressureHpa: 850,
    upperPressureHpa: 500,
    diagnostics: ["temperature_lapse_rate"],
  },
  series: [{
    kind: "layer",
    validTime: "2026-08-23T15:00:00Z",
    forecastHour: 3,
    layer: {
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      lowerGeopotentialHeightGpm: 1500,
      upperGeopotentialHeightGpm: 5500,
      depthGpm: 4000,
    },
    diagnostics: [{ id: "temperature_lapse_rate", values: { temperatureLapseRateCPerKm: 6 } }],
    cacheHit: true,
  }],
};

const distribution = {
  memberCount: 2,
  mean: 6,
  populationStdDev: 0.2,
  min: 5.8,
  max: 6.2,
  quantiles: [{ quantile: 0.5, value: 6 }],
};

const gefsResult: GefsDiagnosticTimeSeriesResult = {
  model: "gefs_0p50",
  run: "2026-08-23T12:00:00Z",
  startTime: "2026-08-23T15:00:00Z",
  endTime: "2026-08-23T18:00:00Z",
  stepHours: 3,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    diagnostic: {
      kind: "layer",
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate"],
    },
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  series: [{
    kind: "layer",
    validTime: "2026-08-23T15:00:00Z",
    forecastHour: 3,
    pressureLayer: { lowerPressureHpa: 850, upperPressureHpa: 500 },
    layerDepthGpm: { ...distribution, mean: 4000, min: 3999.8, max: 4000.2 },
    summaries: [{
      id: "temperature_lapse_rate",
      field: "temperatureLapseRateCPerKm",
      unit: "degC/km",
      distribution,
    }],
    allCacheHit: true,
  }],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    product: "pgrb2a_0p50",
    allCacheHit: true,
  },
};


const historicalResult: HistoricalDiagnosticTimeSeriesResult = {
  model: "gfs_grid4_analysis_0p5",
  requestedStartTime: "2017-05-09T12:00:00.000Z",
  requestedEndTime: "2017-05-09T12:00:00.000Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  diagnostic: {
    kind: "layer",
    lowerPressureHpa: 850,
    upperPressureHpa: 500,
    diagnostics: ["temperature_lapse_rate"],
  },
  cycleHoursUtc: [12],
  source: { provider: "NOAA NCEI", access: "ncei_thredds_ncss" },
  series: [{
    kind: "layer",
    analysisTime: "2017-05-09T12:00:00.000Z",
    layer: {
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      lowerGeopotentialHeightGpm: 1500,
      upperGeopotentialHeightGpm: 5600,
      depthGpm: 4100,
    },
    diagnostics: [{ id: "temperature_lapse_rate", values: { temperatureLapseRateCPerKm: 6.5 } }],
    dataset: "archive.grb2",
    cacheHit: true,
  }],
  caveat: "Diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis",
};

describe("atmospheric diagnostic time-series dispatch", () => {
  it("routes GFS requests", async () => {
    const getDiagnosticTimeSeries = vi.fn(async () => gfsResult);
    const service = new AtmosphericDiagnosticTimeSeriesService({
      gfs: { getDiagnosticTimeSeries },
      gefs: { getDiagnosticTimeSeries: async () => gefsResult },
    });
    const result = await service.getDiagnosticTimeSeries({
      model: "gfs_0p25",
      query: {
        latitude: 50.08,
        longitude: 14.43,
        run: gfsResult.run,
        startTime: gfsResult.requestedStartTime,
        endTime: gfsResult.requestedEndTime,
        diagnostic: gfsResult.diagnostic,
        source: "s3",
      },
    });
    expect(result.model).toBe("gfs_0p25");
    expect(getDiagnosticTimeSeries).toHaveBeenCalledOnce();
  });

  it("routes historical analysis requests without forecast-shaped fields", async () => {
    const getDiagnosticTimeSeries = vi.fn(async () => historicalResult);
    const service = new AtmosphericDiagnosticTimeSeriesService({
      gfs: { getDiagnosticTimeSeries: async () => gfsResult },
      gefs: { getDiagnosticTimeSeries: async () => gefsResult },
      history: { getDiagnosticTimeSeries },
    });
    const result = await service.getDiagnosticTimeSeries({
      model: "gfs_grid4_analysis_0p5",
      query: {
        latitude: historicalResult.requestedPoint.latitude,
        longitude: historicalResult.requestedPoint.longitude,
        startTime: historicalResult.requestedStartTime,
        endTime: historicalResult.requestedEndTime,
        diagnostic: historicalResult.diagnostic,
        cycleHoursUtc: [12],
        maxSteps: 1,
      },
    });
    expect(result.model).toBe("gfs_grid4_analysis_0p5");
    expect("run" in result).toBe(false);
    expect(getDiagnosticTimeSeries).toHaveBeenCalledOnce();
  });

  it("routes GEFS requests", async () => {
    const getDiagnosticTimeSeries = vi.fn(async () => gefsResult);
    const service = new AtmosphericDiagnosticTimeSeriesService({
      gfs: { getDiagnosticTimeSeries: async () => gfsResult },
      gefs: { getDiagnosticTimeSeries },
    });
    const result = await service.getDiagnosticTimeSeries({
      model: "gefs_0p50",
      query: {
        latitude: 50.08,
        longitude: 14.43,
        run: gefsResult.run,
        startTime: gefsResult.startTime,
        endTime: gefsResult.endTime,
        diagnostic: gefsResult.selection.diagnostic,
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
    });
    expect(result.model).toBe("gefs_0p50");
    expect(getDiagnosticTimeSeries).toHaveBeenCalledOnce();
  });
});
