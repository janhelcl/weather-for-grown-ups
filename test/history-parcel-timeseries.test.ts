import { describe, expect, it, vi } from "vitest";
import { HistoricalParcelTimeSeriesService } from "../src/core/history-parcel-timeseries.js";
import type { HistoricalParcelResult } from "../src/schema/history-parcel.js";

function parcelResult(analysisTime: string): HistoricalParcelResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: { pressureLevelsHpa: [950, 850, 700, 500, 300], parcel: "surface_2m" },
    sampledPressureLevelsHpa: [950, 850, 700, 500, 300],
    levels: [
      { pressureHpa: 950, geopotentialHeightGpm: 550, temperatureC: 27, specificHumidityKgKg: 0.015 },
      { pressureHpa: 850, geopotentialHeightGpm: 1500, temperatureC: 14, specificHumidityKgKg: 0.009 },
      { pressureHpa: 700, geopotentialHeightGpm: 3000, temperatureC: 0, specificHumidityKgKg: 0.004 },
      { pressureHpa: 500, geopotentialHeightGpm: 5600, temperatureC: -22, specificHumidityKgKg: 0.001 },
      { pressureHpa: 300, geopotentialHeightGpm: 9200, temperatureC: -38, specificHumidityKgKg: 0.0003 },
    ],
    parcel: {
      startingState: {
        definition: "surface_2m",
        source: "surface_2m",
        pressureHpa: 1000,
        geopotentialHeightGpm: 100,
        temperatureC: 30,
        specificHumidityKgKg: 0.018,
      },
      lcl: { pressureHpa: 850, temperatureC: 16, dewPointC: 20, withinProfile: true },
      lfc: { pressureHpa: 800, geopotentialHeightGpm: 2000 },
      el: { pressureHpa: 300, geopotentialHeightGpm: 9200 },
      capeJkg: 700,
      cinJkg: -20,
      capeTop: "equilibrium_level",
      cinTop: "lfc",
      parcelPath: [
        {
          pressureHpa: 950,
          geopotentialHeightGpm: 550,
          source: "sampled",
          phase: "dry",
          environmentTemperatureC: 27,
          environmentSpecificHumidityKgKg: 0.015,
          environmentVirtualTemperatureK: 302,
          parcelTemperatureC: 26,
          parcelSpecificHumidityKgKg: 0.018,
          parcelVirtualTemperatureK: 302,
          virtualTemperatureExcessK: 0,
        },
        {
          pressureHpa: 850,
          geopotentialHeightGpm: 1500,
          source: "sampled",
          phase: "saturated",
          environmentTemperatureC: 14,
          environmentSpecificHumidityKgKg: 0.009,
          environmentVirtualTemperatureK: 289,
          parcelTemperatureC: 18,
          parcelSpecificHumidityKgKg: 0.012,
          parcelVirtualTemperatureK: 293,
          virtualTemperatureExcessK: 4,
        },
      ],
    },
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: `${analysisTime.slice(0, 10)}.grb2`,
      cacheHit: true,
    },
    caveat: "Parcel diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis",
  };
}

const baseQuery = {
  latitude: 50.08,
  longitude: 14.43,
  pressureLevelsHpa: [950, 850, 700, 500, 300],
  parcel: "surface_2m" as const,
};

describe("HistoricalParcelTimeSeriesService", () => {
  it("evaluates selected cycles serially with one stable parcel selection", async () => {
    const getHistoricalParcel = vi.fn(async (query: { analysisTime: string }) =>
      parcelResult(new Date(query.analysisTime).toISOString()),
    );
    const service = new HistoricalParcelTimeSeriesService({
      parcelGetter: { getHistoricalParcel } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });

    const result = await service.getHistoricalParcelTimeSeries({
      ...baseQuery,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-10T23:59:59Z",
      cycleHoursUtc: [12],
      maxSteps: 2,
    });

    expect(getHistoricalParcel.mock.calls.map(([query]) => query.analysisTime)).toEqual([
      "2017-05-09T12:00:00.000Z",
      "2017-05-10T12:00:00.000Z",
    ]);
    expect(result.selection).toEqual({
      pressureLevelsHpa: [950, 850, 700, 500, 300],
      parcel: "surface_2m",
      cycleHoursUtc: [12],
    });
    expect(result.series.map((step) => step.analysisTime)).toEqual([
      "2017-05-09T12:00:00.000Z",
      "2017-05-10T12:00:00.000Z",
    ]);
  });

  it("rejects an over-budget range before parcel retrieval", async () => {
    const getHistoricalParcel = vi.fn();
    const service = new HistoricalParcelTimeSeriesService({
      parcelGetter: { getHistoricalParcel } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    await expect(service.getHistoricalParcelTimeSeries({
      ...baseQuery,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-11T23:59:59Z",
      cycleHoursUtc: [12],
      maxSteps: 2,
    })).rejects.toThrow(/exceeding maxSteps=2/);
    expect(getHistoricalParcel).not.toHaveBeenCalled();
  });

  it("rejects ranges before the Grid 4 analysis archive", async () => {
    const getHistoricalParcel = vi.fn();
    const service = new HistoricalParcelTimeSeriesService({
      parcelGetter: { getHistoricalParcel } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    await expect(service.getHistoricalParcelTimeSeries({
      ...baseQuery,
      startTime: "2006-12-31T12:00:00Z",
      endTime: "2007-01-01T12:00:00Z",
      cycleHoursUtc: [12],
      maxSteps: 2,
    })).rejects.toThrow(/begins at 2007-01-01/);
    expect(getHistoricalParcel).not.toHaveBeenCalled();
  });

  it("rejects future historical parcel ranges", async () => {
    const getHistoricalParcel = vi.fn();
    const service = new HistoricalParcelTimeSeriesService({
      parcelGetter: { getHistoricalParcel } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    await expect(service.getHistoricalParcelTimeSeries({
      ...baseQuery,
      startTime: "2026-08-26T12:00:00Z",
      endTime: "2026-08-26T18:00:00Z",
      cycleHoursUtc: [12, 18],
      maxSteps: 2,
    })).rejects.toThrow(/must not be in the future/);
    expect(getHistoricalParcel).not.toHaveBeenCalled();
  });
});
