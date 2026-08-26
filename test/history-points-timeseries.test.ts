import { describe, expect, it, vi } from "vitest";
import { AtmosphericPointsTimeSeriesService } from "../src/core/atmospheric-points-timeseries-service.js";
import { HistoricalPointsTimeSeriesService } from "../src/core/history-points-timeseries.js";
import type { HistoricalPointsResult } from "../src/schema/history-points.js";

const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.2, longitude: 16.61 },
];

function batch(analysisTime: string): HistoricalPointsResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    },
    points: points.map((point) => ({
      requestedPoint: point,
      gridPoint: {
        latitude: Math.round(point.latitude * 2) / 2,
        longitude: Math.round(point.longitude * 2) / 2,
      },
      levels: [{ pressureHpa: 850, temperatureC: point.latitude }],
      dataset: "archive.grb2",
      cacheHit: true,
    })),
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      composition: "serial_point_queries",
    },
    caveat: "GFS model analysis; not direct observations or homogeneous climatological reanalysis",
  };
}

describe("HistoricalPointsTimeSeriesService", () => {
  it("composes selected analysis cycles serially over the historical points primitive", async () => {
    let active = 0;
    let maxActive = 0;
    const getPoints = vi.fn(async (query: { analysisTime: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return batch(new Date(query.analysisTime).toISOString());
    });
    const service = new HistoricalPointsTimeSeriesService({
      pointsGetter: { getPoints } as never,
      now: () => new Date("2017-05-10T00:00:00Z"),
    });

    const result = await service.getPointsTimeSeries({
      points,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-09T06:00:00Z",
      cycleHoursUtc: [0, 6],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxSteps: 2,
      maxPointSteps: 4,
    });

    expect(maxActive).toBe(1);
    expect(getPoints).toHaveBeenCalledTimes(2);
    expect(result.series).toHaveLength(2);
    expect(result.source.composition).toBe("serial_cycle_point_queries");
    expect(result.series[1]?.points[0]?.gridPoint).toEqual(result.series[0]?.points[0]?.gridPoint);
  });

  it("guards the point-step matrix before archive work", async () => {
    const getPoints = vi.fn();
    const service = new HistoricalPointsTimeSeriesService({
      pointsGetter: { getPoints } as never,
      now: () => new Date("2017-05-10T00:00:00Z"),
    });

    await expect(service.getPointsTimeSeries({
      points,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-09T12:00:00Z",
      cycleHoursUtc: [0, 6, 12],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxSteps: 3,
      maxPointSteps: 5,
    })).rejects.toThrow(/6 point-steps, exceeding maxPointSteps=5/);

    expect(getPoints).not.toHaveBeenCalled();
  });

  it("participates in the shared atmospheric points-time-series dispatcher", async () => {
    const result = {
      model: "gfs_grid4_analysis_0p5" as const,
      requestedStartTime: "2017-05-09T00:00:00.000Z",
      requestedEndTime: "2017-05-09T00:00:00.000Z",
      selection: { variables: ["temperature" as const], pressureLevelsHpa: [850], cycleHoursUtc: [0 as const] },
      source: {
        provider: "NOAA NCEI" as const,
        access: "ncei_thredds_ncss" as const,
        composition: "serial_cycle_point_queries" as const,
      },
      series: [{ analysisTime: "2017-05-09T00:00:00.000Z", points: batch("2017-05-09T00:00:00.000Z").points }],
      caveat: "GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const,
    };
    const getPointsTimeSeries = vi.fn(async () => result);
    const service = new AtmosphericPointsTimeSeriesService({
      history: { getPointsTimeSeries },
      gfs: { getPointsTimeSeries: vi.fn() } as never,
      gefs: { getPointsTimeSeries: vi.fn() } as never,
    });

    const dispatched = await service.getPointsTimeSeries({
      model: "gfs_grid4_analysis_0p5",
      query: {
        points,
        startTime: result.requestedStartTime,
        endTime: result.requestedEndTime,
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        cycleHoursUtc: [0],
        maxSteps: 1,
        maxPointSteps: 2,
      },
    });

    expect(dispatched.model).toBe("gfs_grid4_analysis_0p5");
    expect(getPointsTimeSeries).toHaveBeenCalledOnce();
  });
});
