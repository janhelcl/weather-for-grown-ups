import { describe, expect, it } from "vitest";
import { GefsPointsTimeSeriesService } from "../src/core/gefs-points-timeseries.js";
import type { GefsBatchPointsQueryInput, GefsBatchPointsResult } from "../src/schema/gefs-batch-points.js";

const run = "2026-08-24T00:00:00.000Z";
const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.2, longitude: 16.61 },
];

function resultFor(query: GefsBatchPointsQueryInput, shiftSecondGrid = false): GefsBatchPointsResult {
  const validTime = new Date(query.validTime);
  const forecastHour = (validTime.getTime() - new Date(run).getTime()) / 3_600_000;
  const members = query.members ?? ["c00", "p01", "p02"];
  const quantiles = query.quantiles ?? [0.1, 0.5, 0.9];
  const pointResults = query.points.map((point, pointIndex) => {
    const base = forecastHour + pointIndex * 10;
    const values = members.map((member, memberIndex) => ({ member, value: base + memberIndex }));
    return {
      requestedPoint: point,
      gridPoint: pointIndex === 0
        ? { latitude: 50, longitude: shiftSecondGrid && forecastHour === 6 ? 15 : 14.5 }
        : { latitude: 49, longitude: 16.5 },
      summary: {
        memberCount: members.length,
        mean: base + (members.length - 1) / 2,
        populationStdDev: Math.sqrt(2 / 3),
        min: base,
        max: base + members.length - 1,
        quantiles: quantiles.map((quantile) => ({ quantile, value: base + 1 })),
        ...(query.thresholdGte === undefined ? {} : {
          threshold: {
            operator: "gte" as const,
            value: query.thresholdGte,
            count: values.filter((sample) => sample.value >= query.thresholdGte!).length,
            fraction: values.filter((sample) => sample.value >= query.thresholdGte!).length / values.length,
            interpretation: "raw_member_fraction_not_calibrated_probability" as const,
          },
        }),
      },
      ...(query.includeMembers ? { members: values } : {}),
    };
  });

  return {
    model: "gefs_0p50",
    run,
    validTime: validTime.toISOString(),
    forecastHour,
    selection: {
      variable: query.variable,
      gfsCode: query.variable === "temperature" ? "TMP" : "RH",
      pressureLevelHpa: query.pressureLevelHpa,
      outputField: query.variable === "temperature" ? "temperatureC" : "relativeHumidityPct",
      unit: query.variable === "temperature" ? "degC" : "%",
      members,
      quantiles,
      ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
    },
    points: pointResults,
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      product: "pgrb2a_0p50",
      memberFiles: members.map((member) => ({ member, cacheHit: forecastHour === 3 })),
      allCacheHit: forecastHour === 3,
    },
  };
}

describe("GEFS multi-point time-series service", () => {
  it("resolves one run for the matrix and performs one batched point query per native step", async () => {
    const calls: GefsBatchPointsQueryInput[] = [];
    let resolutions = 0;
    const service = new GefsPointsTimeSeriesService({
      stepConcurrency: 2,
      latestRunRangeProvider: {
        resolveLatestRunRange: async (start, end, members) => {
          resolutions += 1;
          expect(start.toISOString()).toBe("2026-08-24T03:00:00.000Z");
          expect(end.toISOString()).toBe("2026-08-24T09:00:00.000Z");
          expect(members).toEqual(["c00", "p01", "p02"]);
          return new Date(run);
        },
      },
      batchPointsGetter: {
        getPoints: async (query) => {
          calls.push(query);
          return resultFor(query);
        },
      },
    });

    const result = await service.getPointsTimeSeries({
      points,
      run: "latest",
      startTime: "2026-08-24T03:00:00Z",
      endTime: "2026-08-24T09:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p02", "c00", "p01"],
      quantiles: [0.9, 0.1, 0.5],
      thresholdGte: 5,
    });

    expect(resolutions).toBe(1);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.run === run)).toBe(true);
    expect(calls.every((call) => call.points.length === 2)).toBe(true);
    expect(calls.every((call) => call.members?.join(",") === "c00,p01,p02")).toBe(true);
    expect(calls.every((call) => call.quantiles?.join(",") === "0.1,0.5,0.9")).toBe(true);
    expect(result.run).toBe(run);
    expect(result.stepHours).toBe(3);
    expect(result.selection.members).toEqual(["c00", "p01", "p02"]);
    expect(result.selection.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(result.series.map((step) => step.forecastHour)).toEqual([3, 6, 9]);
    expect(result.series.every((step) => step.points.length === 2)).toBe(true);
    expect(result.series.every((step) => step.points.every((point) => point.members === undefined))).toBe(true);
    expect(result.source.allCacheHit).toBe(false);
  });

  it("includes member values at every point-step only when requested", async () => {
    const service = new GefsPointsTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: async () => new Date(run) },
      batchPointsGetter: { getPoints: async (query) => resultFor(query) },
    });

    const result = await service.getPointsTimeSeries({
      points,
      run,
      startTime: "2026-08-24T03:00:00Z",
      endTime: "2026-08-24T06:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01", "p02"],
      quantiles: [0.5],
      includeMembers: true,
    });

    expect(result.includeMembers).toBe(true);
    expect(result.series).toHaveLength(2);
    expect(result.series[0]?.points[0]?.members?.map((sample) => sample.member)).toEqual(["c00", "p01", "p02"]);
  });

  it("rejects oversized point-step matrices before run resolution or data access", async () => {
    let resolutions = 0;
    let calls = 0;
    const service = new GefsPointsTimeSeriesService({
      latestRunRangeProvider: {
        resolveLatestRunRange: async () => { resolutions += 1; return new Date(run); },
      },
      batchPointsGetter: {
        getPoints: async (query) => { calls += 1; return resultFor(query); },
      },
    });

    await expect(service.getPointsTimeSeries({
      points,
      run: "latest",
      startTime: "2026-08-24T03:00:00Z",
      endTime: "2026-08-24T09:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
      maxSamples: 5,
    })).rejects.toThrow("2 points × 3 steps = 6 point-steps");

    expect(resolutions).toBe(0);
    expect(calls).toBe(0);
  });

  it("rejects grid-cell drift for a requested point across forecast steps", async () => {
    const service = new GefsPointsTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: async () => new Date(run) },
      batchPointsGetter: { getPoints: async (query) => resultFor(query, true) },
    });

    await expect(service.getPointsTimeSeries({
      points,
      run,
      startTime: "2026-08-24T03:00:00Z",
      endTime: "2026-08-24T06:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01", "p02"],
    })).rejects.toThrow("grid point changed across forecast steps for requested point index 0");
  });
});
