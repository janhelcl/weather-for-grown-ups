import { describe, expect, it, vi } from "vitest";
import { HistoricalFieldsTimeSeriesService } from "../src/core/history-fields-timeseries.js";
import type { HistoricalFieldsResult } from "../src/schema/history-fields.js";

const caveat = "GFS model analysis fields; not direct observations or homogeneous climatological reanalysis" as const;

function resultFor(analysisTime: string, cacheHit = true): HistoricalFieldsResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["surface_pressure", "wind_10m"],
    },
    levels: [{ pressureHpa: 850, temperatureC: 12 }],
    fields: [
      {
        id: "surface_pressure",
        level: { type: "surface" },
        temporal: { type: "instantaneous" },
        values: { pressurePa: 100100 },
      },
      {
        id: "wind_10m",
        level: { type: "height_above_ground_m", heightM: 10 },
        temporal: { type: "instantaneous" },
        values: { windSpeedMs: 5, windDirectionDeg: 216.87 },
      },
    ],
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: `${analysisTime.slice(0, 10)}.grb2`,
      cacheHit,
    },
    caveat,
  };
}

describe("HistoricalFieldsTimeSeriesService", () => {
  it("samples selected analysis cycles serially and preserves mixed selection", async () => {
    const getHistoricalFields = vi.fn(async (query: { analysisTime: string }) =>
      resultFor(new Date(query.analysisTime).toISOString(), query.analysisTime.includes("09T")),
    );
    const service = new HistoricalFieldsTimeSeriesService({
      fieldsGetter: { getHistoricalFields } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });

    const result = await service.getHistoricalFieldsTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-10T23:59:59Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["surface_pressure", "wind_10m"],
      cycleHoursUtc: [12],
      maxSteps: 2,
    });

    expect(getHistoricalFields).toHaveBeenCalledTimes(2);
    expect(getHistoricalFields.mock.calls.map(([query]) => query.analysisTime)).toEqual([
      "2017-05-09T12:00:00.000Z",
      "2017-05-10T12:00:00.000Z",
    ]);
    expect(result.selection).toEqual({
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["surface_pressure", "wind_10m"],
      cycleHoursUtc: [12],
    });
    expect(result.series).toHaveLength(2);
    expect(result.series[0]).toMatchObject({
      analysisTime: "2017-05-09T12:00:00.000Z",
      levels: [{ pressureHpa: 850, temperatureC: 12 }],
      fields: [
        { id: "surface_pressure", values: { pressurePa: 100100 } },
        { id: "wind_10m", values: { windSpeedMs: 5 } },
      ],
      cacheHit: true,
    });
  });

  it("rejects a selected range above maxSteps before any archive access", async () => {
    const getHistoricalFields = vi.fn();
    const service = new HistoricalFieldsTimeSeriesService({
      fieldsGetter: { getHistoricalFields } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });

    await expect(service.getHistoricalFieldsTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-11T23:59:59Z",
      fields: ["surface_pressure"],
      cycleHoursUtc: [12],
      maxSteps: 2,
    })).rejects.toThrow(/exceeding maxSteps=2/);
    expect(getHistoricalFields).not.toHaveBeenCalled();
  });

  it("rejects future ranges", async () => {
    const service = new HistoricalFieldsTimeSeriesService({
      fieldsGetter: { getHistoricalFields: vi.fn() } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    await expect(service.getHistoricalFieldsTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      startTime: "2026-08-26T12:00:00Z",
      endTime: "2026-08-26T18:00:00Z",
      fields: ["surface_pressure"],
      cycleHoursUtc: [12, 18],
      maxSteps: 2,
    })).rejects.toThrow(/must not be in the future/);
  });
});
