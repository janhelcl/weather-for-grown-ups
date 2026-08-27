import { describe, expect, it, vi } from "vitest";
import { GefsPointsBundleTimeSeriesService } from "../src/core/gefs-points-bundle-timeseries.js";
import type { GefsPointsBundleResult } from "../src/schema/gefs-points-bundle.js";

const run = new Date("2026-08-24T00:00:00Z");
const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.2, longitude: 16.61 },
  { latitude: 47.81, longitude: 13.06 },
];

function resultFor(validTime: string, includeMembers = false): GefsPointsBundleResult {
  const forecastHour = (new Date(validTime).getTime() - run.getTime()) / 3_600_000;
  return {
    model: "gefs_0p50",
    run: run.toISOString(),
    validTime,
    forecastHour,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["temperature_2m", "wind_10m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    },
    includeMembers,
    points: points.map((requestedPoint, index) => ({
      requestedPoint,
      gridPoint: { latitude: 50 - index * 0.5, longitude: 14.5 + index * 2 },
      pressureSummaries: [],
      fieldSummaries: [],
      ...(includeMembers
        ? {
            members: ["c00", "p01"].map((member) => ({
              member: member as "c00" | "p01",
              cacheHit: true,
              pressureValues: [],
              fields: [],
            })),
          }
        : {}),
    })),
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      product: "pgrb2a_0p50",
      horizontalGridDegrees: 0.5,
      memberFiles: [
        { member: "c00", cacheHit: true },
        { member: "p01", cacheHit: true },
      ],
      allCacheHit: true,
    },
  };
}

describe("GEFS multi-point mixed bundle time series", () => {
  it("resolves one run for the complete range and composes one multi-point bundle per native step", async () => {
    const resolveLatestRunRange = vi.fn(async () => run);
    const getPoints = vi.fn(async (query: { validTime: string; includeMembers?: boolean }) =>
      resultFor(query.validTime, Boolean(query.includeMembers)));
    const service = new GefsPointsBundleTimeSeriesService({
      pointsGetter: { getPoints },
      latestRunRangeProvider: { resolveLatestRunRange },
      stepConcurrency: 1,
    });

    const result = await service.getPointsTimeSeries({
      points,
      run: "latest",
      startTime: "2026-08-24T03:00:00Z",
      endTime: "2026-08-24T06:00:00Z",
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m", "wind_10m"],
      },
      members: ["p01", "c00"],
      quantiles: [0.5],
      maxSteps: 2,
      maxPointSteps: 6,
    });

    expect(resolveLatestRunRange).toHaveBeenCalledTimes(1);
    expect(getPoints).toHaveBeenCalledTimes(2);
    expect(getPoints.mock.calls.every(([query]) => query.run === run.toISOString())).toBe(true);
    expect(result.run).toBe(run.toISOString());
    expect(result.series.map((step) => step.forecastHour)).toEqual([3, 6]);
    expect(result.series.every((step) => step.points.map((point) => point.requestedPoint).every((point, i) => point.latitude === points[i]?.latitude && point.longitude === points[i]?.longitude))).toBe(true);
    expect(result.selection.members).toEqual(["c00", "p01"]);
    expect(result.source.allCacheHit).toBe(true);
  });

  it("checks point-step and includeMembers payload bounds before run resolution", async () => {
    const resolveLatestRunRange = vi.fn(async () => run);
    const getPoints = vi.fn();
    const service = new GefsPointsBundleTimeSeriesService({
      pointsGetter: { getPoints },
      latestRunRangeProvider: { resolveLatestRunRange },
    });

    await expect(service.getPointsTimeSeries({
      points,
      run: "latest",
      startTime: "2026-08-24T03:00:00Z",
      endTime: "2026-08-24T06:00:00Z",
      selection: { fields: ["temperature_2m"] },
      members: ["c00", "p01"],
      maxPointSteps: 5,
    })).rejects.toThrow("exceeding maxPointSteps=5");

    expect(resolveLatestRunRange).not.toHaveBeenCalled();
    expect(getPoints).not.toHaveBeenCalled();

    await expect(service.getPointsTimeSeries({
      points,
      run: "latest",
      startTime: "2026-08-24T03:00:00Z",
      endTime: "2026-08-24T06:00:00Z",
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m", "wind_10m"],
      },
      members: ["c00", "p01"],
      includeMembers: true,
      maxPointSteps: 6,
      maxMemberSamples: 47,
    })).rejects.toThrow("exceeding maxMemberSamples=47");

    expect(resolveLatestRunRange).not.toHaveBeenCalled();
    expect(getPoints).not.toHaveBeenCalled();
  });

  it("rejects grid-cell drift for the same requested point across forecast steps", async () => {
    const getPoints = vi.fn(async (query: { validTime: string }) => {
      const result = resultFor(query.validTime);
      if (query.validTime === "2026-08-24T06:00:00.000Z") {
        result.points[1]!.gridPoint = { latitude: 48.5, longitude: 17 };
      }
      return result;
    });
    const service = new GefsPointsBundleTimeSeriesService({
      pointsGetter: { getPoints },
      latestRunRangeProvider: { resolveLatestRunRange: async () => run },
      stepConcurrency: 1,
    });

    await expect(service.getPointsTimeSeries({
      points,
      run: run.toISOString(),
      startTime: "2026-08-24T03:00:00Z",
      endTime: "2026-08-24T06:00:00Z",
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m", "wind_10m"],
      },
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxPointSteps: 6,
    })).rejects.toThrow("grid point changed across forecast steps");
  });
});
