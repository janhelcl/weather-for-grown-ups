import { describe, expect, it } from "vitest";
import { GefsPointsBundleTimeSeriesService } from "../src/core/gefs-points-bundle-timeseries.js";
import type { GefsPointsBundleResult } from "../src/schema/gefs-points-bundle.js";

const run = new Date("2026-08-24T00:00:00Z");
const point = { latitude: 50.08, longitude: 14.43 };

function memberBatch(validTime: string, product: "pgrb2a_0p50" | "pgrb2s_0p25"): GefsPointsBundleResult {
  const forecastHour = (new Date(validTime).getTime() - run.getTime()) / 3_600_000;
  return {
    model: "gefs_0p50",
    run: run.toISOString(),
    validTime,
    forecastHour,
    selection: {
      variables: [],
      pressureLevelsHpa: [],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    },
    includeMembers: true,
    points: [{
      requestedPoint: point,
      gridPoint: { latitude: 50, longitude: 14.5 },
      pressureSummaries: [],
      fieldSummaries: [],
      members: [
        { member: "c00", cacheHit: true, pressureValues: [], fields: [] },
        { member: "p01", cacheHit: true, pressureValues: [], fields: [] },
      ],
    }],
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      product,
      horizontalGridDegrees: product === "pgrb2s_0p25" ? 0.25 : 0.5,
      memberFiles: [
        { member: "c00", cacheHit: true },
        { member: "p01", cacheHit: true },
      ],
      allCacheHit: true,
    },
  };
}

describe("GEFS multi-point bundle time-series member payload", () => {
  it("preserves requested member arrays across a valid fixed-run series", async () => {
    const service = new GefsPointsBundleTimeSeriesService({
      pointsGetter: { getPoints: async (query, product = "pgrb2a_0p50") => memberBatch(query.validTime, product) },
      latestRunRangeProvider: { resolveLatestRunRange: async () => run },
      stepConcurrency: 1,
    });

    const result = await service.getPointsTimeSeries({
      points: [point],
      run: run.toISOString(),
      startTime: "2026-08-24T03:00:00Z",
      endTime: "2026-08-24T06:00:00Z",
      selection: { fields: ["temperature_2m"] },
      members: ["c00", "p01"],
      quantiles: [0.5],
      includeMembers: true,
      maxPointSteps: 2,
      maxMemberSamples: 4,
    });

    expect(result.includeMembers).toBe(true);
    expect(result.source).toMatchObject({ product: "pgrb2s_0p25", horizontalGridDegrees: 0.25 });
    expect(result.series).toHaveLength(2);
    expect(result.series.every((step) => step.points[0]?.members?.length === 2)).toBe(true);
  });
});
