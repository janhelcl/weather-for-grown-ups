import { describe, expect, it, vi } from "vitest";
import { HistoricalDiagnosticTimeSeriesService } from "../src/core/history-diagnostic-timeseries.js";
import type { HistoricalLayerDiagnosticsResult } from "../src/schema/history-diagnostics.js";

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

    const service = new HistoricalDiagnosticTimeSeriesService({
      layerDiagnosticsGetter: { getLayerDiagnostics } as never,
      profileDiagnosticsGetter: { getProfileDiagnostics: vi.fn() } as never,
      parcelDiagnosticsGetter: { getHistoricalParcel: vi.fn() } as never,
      now: () => new Date("2017-05-10T00:00:00Z"),
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

  it("enforces the historical maxSteps guard before archive work", async () => {
    const getLayerDiagnostics = vi.fn(async () => layerResult("2017-05-09T00:00:00.000Z"));
    const service = new HistoricalDiagnosticTimeSeriesService({
      layerDiagnosticsGetter: { getLayerDiagnostics } as never,
      profileDiagnosticsGetter: { getProfileDiagnostics: vi.fn() } as never,
      parcelDiagnosticsGetter: { getHistoricalParcel: vi.fn() } as never,
      now: () => new Date("2017-05-10T00:00:00Z"),
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
});
