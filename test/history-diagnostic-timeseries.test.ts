import { describe, expect, it, vi } from "vitest";
import { HistoricalDiagnosticTimeSeriesService } from "../src/core/history-diagnostic-timeseries.js";
import { deriveParcelComputation } from "../src/derived/parcel-diagnostics.js";
import type {
  HistoricalLayerDiagnosticsResult,
  HistoricalProfileDiagnosticsResult,
} from "../src/schema/history-diagnostics.js";
import type { HistoricalParcelResult } from "../src/schema/history-parcel.js";

const point = { latitude: 50.08, longitude: 14.43 };
const gridPoint = { latitude: 50, longitude: 14.5 };
const caveat = "Diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const;

function layerResult(analysisTime: string): HistoricalLayerDiagnosticsResult {
  return {
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
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: `grid4-${analysisTime}.grb2`,
      cacheHit: true,
    },
    caveat,
  };
}

function profileResult(analysisTime: string): HistoricalProfileDiagnosticsResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: point,
    gridPoint,
    sampledPressureLevelsHpa: [850, 700, 500],
    levels: [
      { pressureHpa: 850, temperatureC: 4, geopotentialHeightGpm: 1500 },
      { pressureHpa: 700, temperatureC: -3, geopotentialHeightGpm: 3000 },
      { pressureHpa: 500, temperatureC: -20, geopotentialHeightGpm: 5600 },
    ],
    diagnostics: [{ id: "freezing_level_crossings", crossings: [] }],
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: `grid4-${analysisTime}.grb2`,
      cacheHit: false,
    },
    caveat,
  };
}

function parcelResult(analysisTime: string): HistoricalParcelResult {
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
  const surface = {
    pressureHpa: 1000,
    geopotentialHeightGpm: 100,
    temperatureC: 30,
    specificHumidityKgKg: 0.018,
  };
  const parcel = deriveParcelComputation("surface_2m", surface, levels);
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: point,
    gridPoint,
    selection: { pressureLevelsHpa: levels.map((level) => level.pressureHpa), parcel: "surface_2m" },
    sampledPressureLevelsHpa: levels.map((level) => level.pressureHpa),
    levels,
    parcel,
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: `grid4-${analysisTime}.grb2`,
      cacheHit: true,
    },
    caveat: "Parcel diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis",
  };
}

function serviceWith(overrides: ConstructorParameters<typeof HistoricalDiagnosticTimeSeriesService>[0] = {}) {
  return new HistoricalDiagnosticTimeSeriesService({
    layerDiagnosticsGetter: { getLayerDiagnostics: async (query) => layerResult(new Date(query.analysisTime).toISOString()) },
    profileDiagnosticsGetter: { getProfileDiagnostics: async (query) => profileResult(new Date(query.analysisTime).toISOString()) },
    parcelDiagnosticsGetter: { getHistoricalParcel: async (query) => parcelResult(new Date(query.analysisTime).toISOString()) },
    now: () => new Date("2017-05-10T00:00:00Z"),
    ...overrides,
  });
}

describe("HistoricalDiagnosticTimeSeriesService", () => {
  it("evaluates selected analysis cycles serially and keeps analysis semantics", async () => {
    let active = 0;
    let maxActive = 0;
    const getLayerDiagnostics = vi.fn(async (query: { analysisTime: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return layerResult(new Date(query.analysisTime).toISOString());
    });

    const service = serviceWith({
      layerDiagnosticsGetter: { getLayerDiagnostics } as never,
    });

    const result = await service.getDiagnosticTimeSeries({
      ...point,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-09T06:00:00Z",
      cycleHoursUtc: [0, 6],
      maxSteps: 2,
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate"],
      },
    });

    expect(maxActive).toBe(1);
    expect(getLayerDiagnostics).toHaveBeenCalledTimes(2);
    expect(result.model).toBe("gfs_grid4_analysis_0p5");
    expect(result.series.map((step) => step.analysisTime)).toEqual([
      "2017-05-09T00:00:00.000Z",
      "2017-05-09T06:00:00.000Z",
    ]);
    expect(result.series.every((step) => !("forecastHour" in step))).toBe(true);
    expect("run" in result).toBe(false);
    expect(result.source).toEqual({
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
    });
  });

  it("routes profile diagnostics and normalizes duplicate selection entries", async () => {
    const getProfileDiagnostics = vi.fn(async (query: { analysisTime: string }) =>
      profileResult(new Date(query.analysisTime).toISOString()));
    const service = serviceWith({
      profileDiagnosticsGetter: { getProfileDiagnostics } as never,
    });

    const result = await service.getDiagnosticTimeSeries({
      ...point,
      startTime: "2017-05-09T12:00:00Z",
      endTime: "2017-05-09T12:00:00Z",
      cycleHoursUtc: [12],
      maxSteps: 1,
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700, 700, 500],
        diagnostics: ["freezing_level_crossings", "freezing_level_crossings"],
      },
    });

    expect(getProfileDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      pressureLevelsHpa: [850, 700, 500],
      diagnostics: ["freezing_level_crossings"],
    }));
    expect(result.diagnostic).toEqual({
      kind: "profile",
      pressureLevelsHpa: [850, 700, 500],
      diagnostics: ["freezing_level_crossings"],
    });
    expect(result.series[0]).toMatchObject({
      kind: "profile",
      diagnostics: [{ id: "freezing_level_crossings" }],
      cacheHit: false,
    });
  });

  it("routes parcel diagnostics, de-duplicates levels, and compacts parcel paths", async () => {
    const getHistoricalParcel = vi.fn(async (query: { analysisTime: string }) =>
      parcelResult(new Date(query.analysisTime).toISOString()));
    const service = serviceWith({
      parcelDiagnosticsGetter: { getHistoricalParcel } as never,
    });

    const result = await service.getDiagnosticTimeSeries({
      ...point,
      startTime: "2017-05-09T12:00:00Z",
      endTime: "2017-05-09T12:00:00Z",
      cycleHoursUtc: [12],
      maxSteps: 1,
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [950, 900, 850, 850, 700, 500, 300, 250],
        parcel: "surface_2m",
      },
    });

    expect(getHistoricalParcel).toHaveBeenCalledWith(expect.objectContaining({
      pressureLevelsHpa: [950, 900, 850, 700, 500, 300, 250],
      parcel: "surface_2m",
    }));
    const step = result.series[0];
    expect(step?.kind).toBe("parcel");
    if (step?.kind === "parcel") {
      expect(step.parcel.capeJkg).toBeGreaterThanOrEqual(0);
      expect("parcelPath" in step.parcel).toBe(false);
    }
  });

  it("enforces the historical maxSteps guard before archive work", async () => {
    const getLayerDiagnostics = vi.fn(async () => layerResult("2017-05-09T00:00:00.000Z"));
    const service = serviceWith({
      layerDiagnosticsGetter: { getLayerDiagnostics } as never,
    });

    await expect(service.getDiagnosticTimeSeries({
      ...point,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-09T12:00:00Z",
      cycleHoursUtc: [0, 6, 12],
      maxSteps: 2,
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate"],
      },
    })).rejects.toThrow(/exceeding maxSteps=2/);

    expect(getLayerDiagnostics).not.toHaveBeenCalled();
  });

  it("rejects ranges before the archive, future ranges, and ranges with no selected cycles", async () => {
    const selection = {
      kind: "layer" as const,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate" as const],
    };
    const service = serviceWith();

    await expect(service.getDiagnosticTimeSeries({
      ...point,
      startTime: "2006-12-31T18:00:00Z",
      endTime: "2006-12-31T18:00:00Z",
      diagnostic: selection,
      cycleHoursUtc: [18],
      maxSteps: 1,
    })).rejects.toThrow(/history begins/);

    await expect(service.getDiagnosticTimeSeries({
      ...point,
      startTime: "2017-05-10T06:00:00Z",
      endTime: "2017-05-10T06:00:00Z",
      diagnostic: selection,
      cycleHoursUtc: [6],
      maxSteps: 1,
    })).rejects.toThrow(/must not be in the future/);

    await expect(service.getDiagnosticTimeSeries({
      ...point,
      startTime: "2017-05-09T01:00:00Z",
      endTime: "2017-05-09T02:00:00Z",
      diagnostic: selection,
      cycleHoursUtc: [12],
      maxSteps: 1,
    })).rejects.toThrow(/contains no selected GFS analysis cycles/);
  });

  it("rejects time, grid, and source drift from diagnostic getters", async () => {
    const baseQuery = {
      ...point,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-09T06:00:00Z",
      cycleHoursUtc: [0, 6] as const,
      maxSteps: 2,
      diagnostic: {
        kind: "layer" as const,
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate" as const],
      },
    };

    let call = 0;
    await expect(serviceWith({
      layerDiagnosticsGetter: {
        getLayerDiagnostics: async (query) => {
          call += 1;
          const expected = layerResult(new Date(query.analysisTime).toISOString());
          return call === 2 ? { ...expected, analysisTime: "2017-05-09T12:00:00.000Z" } : expected;
        },
      },
    }).getDiagnosticTimeSeries(baseQuery)).rejects.toThrow(/result time changed/);

    call = 0;
    await expect(serviceWith({
      layerDiagnosticsGetter: {
        getLayerDiagnostics: async (query) => {
          call += 1;
          const expected = layerResult(new Date(query.analysisTime).toISOString());
          return call === 2 ? { ...expected, gridPoint: { latitude: 49.5, longitude: 14.5 } } : expected;
        },
      },
    }).getDiagnosticTimeSeries(baseQuery)).rejects.toThrow(/grid point changed/);

    call = 0;
    await expect(serviceWith({
      layerDiagnosticsGetter: {
        getLayerDiagnostics: async (query) => {
          call += 1;
          const expected = layerResult(new Date(query.analysisTime).toISOString());
          return call === 2
            ? { ...expected, source: { ...expected.source, access: "other" as never } }
            : expected;
        },
      },
    }).getDiagnosticTimeSeries(baseQuery)).rejects.toThrow(/data source changed/);
  });
});
