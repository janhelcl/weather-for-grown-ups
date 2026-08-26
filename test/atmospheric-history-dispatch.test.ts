import { describe, expect, it, vi } from "vitest";
import { AtmosphericLayerDiagnosticsService } from "../src/core/atmospheric-layer-diagnostics-service.js";
import { AtmosphericProfileDiagnosticsService } from "../src/core/atmospheric-profile-diagnostics-service.js";
import { AtmosphericProfileService } from "../src/core/atmospheric-profile-service.js";
import { AtmosphericTimeSeriesService } from "../src/core/atmospheric-timeseries-service.js";
import type {
  HistoricalLayerDiagnosticsResult,
  HistoricalProfileDiagnosticsResult,
} from "../src/schema/history-diagnostics.js";
import type {
  HistoricalProfileResult,
  HistoricalTimeSeriesResult,
} from "../src/schema/history-result.js";

const analysisTime = "2017-05-09T12:00:00.000Z";
const point = { latitude: 50.08, longitude: 14.43 };
const gridPoint = { latitude: 50, longitude: 14.5 };
const source = {
  provider: "NOAA NCEI" as const,
  access: "ncei_thredds_ncss" as const,
  dataset: "archive.grb2",
  cacheHit: true,
};

const profile: HistoricalProfileResult = {
  model: "gfs_grid4_analysis_0p5",
  analysisTime,
  requestedPoint: point,
  gridPoint,
  selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
  levels: [{ pressureHpa: 850, temperatureC: 7 }],
  source,
  caveat: "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
};

const timeseries: HistoricalTimeSeriesResult = {
  model: "gfs_grid4_analysis_0p5",
  requestedStartTime: analysisTime,
  requestedEndTime: analysisTime,
  requestedPoint: point,
  gridPoint,
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850],
    cycleHoursUtc: [12],
  },
  source: {
    provider: "NOAA NCEI",
    access: "ncei_thredds_ncss",
  },
  series: [{
    analysisTime,
    levels: profile.levels,
    dataset: source.dataset,
    cacheHit: true,
  }],
  caveat: profile.caveat,
};

const layerDiagnostics: HistoricalLayerDiagnosticsResult = {
  model: "gfs_grid4_analysis_0p5",
  analysisTime,
  requestedPoint: point,
  gridPoint,
  layer: {
    lowerPressureHpa: 850,
    upperPressureHpa: 500,
    lowerGeopotentialHeightGpm: 1500,
    upperGeopotentialHeightGpm: 5600,
    depthGpm: 4100,
  },
  levels: [
    { pressureHpa: 850, temperatureC: 7, geopotentialHeightGpm: 1500 },
    { pressureHpa: 500, temperatureC: -20, geopotentialHeightGpm: 5600 },
  ],
  diagnostics: [{
    id: "temperature_lapse_rate",
    values: { temperatureLapseRateCPerKm: 6.5853658537 },
  }],
  source,
  caveat: "Diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis",
};

const profileDiagnostics: HistoricalProfileDiagnosticsResult = {
  model: "gfs_grid4_analysis_0p5",
  analysisTime,
  requestedPoint: point,
  gridPoint,
  sampledPressureLevelsHpa: [850, 500],
  levels: layerDiagnostics.levels,
  diagnostics: [{ id: "freezing_level_crossings", crossings: [] }],
  source,
  caveat: layerDiagnostics.caveat,
};

describe("historical analysis through shared atmospheric dispatch", () => {
  it("routes pressure profiles through the common profile operation", async () => {
    const getHistoricalProfile = vi.fn(async () => profile);
    const service = new AtmosphericProfileService({ history: { getHistoricalProfile } });

    const result = await service.getProfile({
      model: "gfs_grid4_analysis_0p5",
      query: {
        latitude: point.latitude,
        longitude: point.longitude,
        analysisTime,
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });

    expect(result.model).toBe("gfs_grid4_analysis_0p5");
    expect(getHistoricalProfile).toHaveBeenCalledOnce();
  });

  it("routes analysis ranges through the common time-series operation", async () => {
    const getHistoricalTimeSeries = vi.fn(async () => timeseries);
    const service = new AtmosphericTimeSeriesService({ history: { getHistoricalTimeSeries } });

    const result = await service.getTimeSeries({
      model: "gfs_grid4_analysis_0p5",
      query: {
        latitude: point.latitude,
        longitude: point.longitude,
        startTime: analysisTime,
        endTime: analysisTime,
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        cycleHoursUtc: [12],
        maxSteps: 1,
      },
    });

    expect(result.model).toBe("gfs_grid4_analysis_0p5");
    expect(getHistoricalTimeSeries).toHaveBeenCalledOnce();
  });

  it("routes layer diagnostics through the same meteorological operation", async () => {
    const getLayerDiagnostics = vi.fn(async () => layerDiagnostics);
    const service = new AtmosphericLayerDiagnosticsService({ history: { getLayerDiagnostics } });

    const result = await service.getLayerDiagnostics({
      model: "gfs_grid4_analysis_0p5",
      query: {
        latitude: point.latitude,
        longitude: point.longitude,
        analysisTime,
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate"],
      },
    });

    expect(result.model).toBe("gfs_grid4_analysis_0p5");
    expect(getLayerDiagnostics).toHaveBeenCalledOnce();
  });

  it("routes whole-profile diagnostics without converting analysis semantics into forecast semantics", async () => {
    const getProfileDiagnostics = vi.fn(async () => profileDiagnostics);
    const service = new AtmosphericProfileDiagnosticsService({ history: { getProfileDiagnostics } });

    const result = await service.getProfileDiagnostics({
      model: "gfs_grid4_analysis_0p5",
      query: {
        latitude: point.latitude,
        longitude: point.longitude,
        analysisTime,
        pressureLevelsHpa: [850, 500],
        diagnostics: ["freezing_level_crossings"],
      },
    });

    expect(result).toMatchObject({
      model: "gfs_grid4_analysis_0p5",
      analysisTime,
    });
    expect("forecastHour" in result).toBe(false);
    expect(getProfileDiagnostics).toHaveBeenCalledOnce();
  });
});
