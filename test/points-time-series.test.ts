import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POINTS_TIME_SERIES_CONCURRENCY,
  PointsTimeSeriesService,
} from "../src/core/points-time-series.js";
import type { BatchPointsResult } from "../src/core/types.js";
import type { BatchPointsQueryInput } from "../src/schema/query.js";

const run = "2026-08-19T00:00:00.000Z";

function batchFor(
  query: BatchPointsQueryInput,
  overrides: Partial<BatchPointsResult> = {},
): BatchPointsResult {
  const validTime = new Date(String(query.validTime));
  const forecastHour = (validTime.getTime() - Date.parse(run)) / 3_600_000;
  const points = (query.points ?? []).map((point, index) => ({
    requestedPoint: { latitude: Number(point.latitude), longitude: Number(point.longitude) },
    gridPoint: {
      latitude: Math.round(Number(point.latitude) * 4) / 4,
      longitude: Math.round(Number(point.longitude) * 4) / 4,
    },
    levels: [{ pressureHpa: 850, temperatureC: forecastHour + index }],
  }));
  return {
    model: "gfs_0p25",
    run,
    validTime: validTime.toISOString(),
    forecastHour,
    points,
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      cacheHit: forecastHour % 2 === 0,
    },
    ...overrides,
  };
}

const base = {
  points: [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 45.80, longitude: 11.70 },
    { latitude: 46.24, longitude: 13.18 },
  ],
  run,
  startTime: "2026-08-23T22:00:00Z",
  endTime: "2026-08-24T06:00:00Z",
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
};

describe("PointsTimeSeriesService", () => {
  it("uses one ordered batch per native forecast step across the f120 cadence transition", async () => {
    const getPoints = vi.fn(async (query: BatchPointsQueryInput) => batchFor(query));
    const service = new PointsTimeSeriesService({ batchPointsGetter: { getPoints }, concurrency: 3 });
    const result = await service.getPointsTimeSeries(base);

    expect(result.series.map((step) => step.forecastHour)).toEqual([118, 119, 120, 123, 126]);
    expect(result.series.map((step) => step.validTime)).toEqual([
      "2026-08-23T22:00:00.000Z",
      "2026-08-23T23:00:00.000Z",
      "2026-08-24T00:00:00.000Z",
      "2026-08-24T03:00:00.000Z",
      "2026-08-24T06:00:00.000Z",
    ]);
    expect(getPoints).toHaveBeenCalledTimes(5);
    expect(getPoints.mock.calls.every(([query]) => query.points.length === 3)).toBe(true);
    expect(getPoints.mock.calls.every(([query]) => query.run === run)).toBe(true);
    expect(result.series[0]?.points.map((point) => point.requestedPoint)).toEqual(base.points);
    expect(result.series[0]?.points[1]?.levels[0]?.temperatureC).toBe(119);
    expect(result.source).toEqual({
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
    });
  });

  it("defaults to four concurrent forecast-file batches", () => {
    expect(DEFAULT_POINTS_TIME_SERIES_CONCURRENCY).toBe(4);
  });

  it("bounds concurrent forecast-step batches", async () => {
    let active = 0;
    let maxActive = 0;
    const getPoints = vi.fn(async (query: BatchPointsQueryInput) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return batchFor(query);
    });
    const service = new PointsTimeSeriesService({ batchPointsGetter: { getPoints }, concurrency: 2 });
    await service.getPointsTimeSeries({
      ...base,
      startTime: "2026-08-19T00:00:00Z",
      endTime: "2026-08-19T05:00:00Z",
    });
    expect(maxActive).toBe(2);
  });

  it("resolves query-aware latest once for the entire matrix", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(run));
    const getPoints = vi.fn(async (query: BatchPointsQueryInput) => batchFor(query));
    const service = new PointsTimeSeriesService({
      batchPointsGetter: { getPoints },
      latestRunProvider: { resolveLatestRun },
    });

    await service.getPointsTimeSeries({ ...base, run: "latest" });

    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(resolveLatestRun).toHaveBeenCalledWith({
      type: "time_range",
      startTime: new Date(base.startTime),
      endTime: new Date(base.endTime),
      selection: {
        variableCodes: ["TMP"],
        pressureLevelsHpa: [850],
        fields: [],
      },
    });
    expect(getPoints.mock.calls.every(([query]) => query.run === run)).toBe(true);
  });

  it("fails before data access when native steps exceed maxSteps", async () => {
    const getPoints = vi.fn(async (query: BatchPointsQueryInput) => batchFor(query));
    const service = new PointsTimeSeriesService({ batchPointsGetter: { getPoints } });

    await expect(service.getPointsTimeSeries({
      ...base,
      startTime: "2026-08-19T00:00:00Z",
      endTime: "2026-08-19T10:00:00Z",
      maxSteps: 5,
    })).rejects.toThrow(/11 native GFS outputs.*maxSteps=5/);
    expect(getPoints).not.toHaveBeenCalled();
  });

  it("fails before data access when the points × steps matrix exceeds maxSamples", async () => {
    const getPoints = vi.fn(async (query: BatchPointsQueryInput) => batchFor(query));
    const service = new PointsTimeSeriesService({ batchPointsGetter: { getPoints } });

    await expect(service.getPointsTimeSeries({
      ...base,
      startTime: "2026-08-19T00:00:00Z",
      endTime: "2026-08-19T05:00:00Z",
      maxSamples: 10,
    })).rejects.toThrow(/3 points × 6 steps = 18 point-steps.*maxSamples=10/);
    expect(getPoints).not.toHaveBeenCalled();
  });

  it("rejects a grid point that changes across forecast steps", async () => {
    let call = 0;
    const getPoints = vi.fn(async (query: BatchPointsQueryInput) => {
      call += 1;
      const batch = batchFor(query);
      if (call === 2) {
        batch.points[0] = {
          ...batch.points[0]!,
          gridPoint: { latitude: 49.75, longitude: 14.5 },
        };
      }
      return batch;
    });
    const service = new PointsTimeSeriesService({ batchPointsGetter: { getPoints } });

    await expect(service.getPointsTimeSeries({
      ...base,
      endTime: "2026-08-23T23:00:00Z",
    })).rejects.toThrow(/grid point changed/);
  });

  it("propagates one failed forecast-step batch", async () => {
    const service = new PointsTimeSeriesService({
      batchPointsGetter: {
        getPoints: async () => { throw new Error("range download failed"); },
      },
    });
    await expect(service.getPointsTimeSeries(base)).rejects.toThrow("range download failed");
  });
});
