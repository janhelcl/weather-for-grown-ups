import { describe, expect, it, vi } from "vitest";
import { GefsTransectService } from "../src/core/gefs-transect.js";
import type { GefsPointsBundleResult } from "../src/schema/gefs-points-bundle.js";

const run = "2026-08-24T00:00:00.000Z";

function batchFor(points: readonly { latitude: number; longitude: number }[], includeMembers = false): GefsPointsBundleResult {
  return {
    model: "gefs_0p50",
    run,
    validTime: "2026-08-24T12:00:00.000Z",
    forecastHour: 12,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    },
    includeMembers,
    points: points.map((requestedPoint, index) => ({
      requestedPoint,
      gridPoint: { latitude: Math.round(requestedPoint.latitude * 2) / 2, longitude: Math.round(requestedPoint.longitude * 2) / 2 },
      pressureSummaries: [{
        variable: "temperature",
        pressureLevelHpa: 850,
        outputField: "temperatureC",
        unit: "degC",
        distribution: {
          memberCount: 2,
          mean: 4 + index,
          populationStdDev: 1,
          min: 3 + index,
          max: 5 + index,
          quantiles: [{ quantile: 0.5, value: 4 + index }],
        },
      }],
      fieldSummaries: [],
      ...(includeMembers ? {
        members: [
          { member: "c00", cacheHit: true, pressureValues: [], fields: [] },
          { member: "p01", cacheHit: true, pressureValues: [], fields: [] },
        ],
      } : {}),
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

const baseQuery = {
  start: { latitude: 50, longitude: 14 },
  end: { latitude: 49, longitude: 16 },
  run,
  validTime: "2026-08-24T12:00:00Z",
  selection: { fields: ["temperature_2m"] as ["temperature_2m"] },
  members: ["c00", "p01"] as ["c00", "p01"],
  samples: 3,
};

describe("GEFS mixed-field transect", () => {
  it("reuses great-circle geometry and delegates the complete path to one multi-point bundle call", async () => {
    const getPoints = vi.fn(async (query: { points: { latitude: number; longitude: number }[]; includeMembers?: boolean }) =>
      batchFor(query.points, Boolean(query.includeMembers)));
    const service = new GefsTransectService({ pointsGetter: { getPoints } });

    const result = await service.getTransect({
      start: { latitude: 50, longitude: 14 },
      end: { latitude: 48, longitude: 17 },
      run,
      validTime: "2026-08-24T12:00:00Z",
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m"],
      },
      members: ["c00", "p01"],
      quantiles: [0.5],
      samples: 5,
    });

    expect(getPoints).toHaveBeenCalledTimes(1);
    expect(getPoints.mock.calls[0]?.[0].points).toHaveLength(5);
    expect(result.samples).toHaveLength(5);
    expect(result.samples[0]?.fraction).toBe(0);
    expect(result.samples[4]?.fraction).toBe(1);
    expect(result.samples[0]?.distanceKm).toBe(0);
    expect(result.samples[4]?.distanceKm).toBeCloseTo(result.totalDistanceKm);
    expect(result.samples[0]?.requestedPoint).toEqual({ latitude: 50, longitude: 14 });
    expect(result.samples[4]?.requestedPoint).toEqual({ latitude: 48, longitude: 17 });
    expect(result.source.memberFiles).toHaveLength(2);
  });

  it("preserves opt-in member values at every transect sample", async () => {
    const service = new GefsTransectService({
      pointsGetter: { getPoints: async (query) => batchFor(query.points, true) },
    });
    const result = await service.getTransect({ ...baseQuery, includeMembers: true });
    expect(result.includeMembers).toBe(true);
    expect(result.samples.every((sample) => sample.members?.length === 2)).toBe(true);
  });

  it("rejects reordered samples from the multi-point primitive", async () => {
    const service = new GefsTransectService({
      pointsGetter: {
        getPoints: async (query) => {
          const batch = batchFor(query.points);
          [batch.points[0], batch.points[1]] = [batch.points[1]!, batch.points[0]!];
          return batch;
        },
      },
    });
    await expect(service.getTransect(baseQuery)).rejects.toThrow("changed requested point order");
  });

  it("rejects a point-count mismatch from the multi-point primitive", async () => {
    const service = new GefsTransectService({
      pointsGetter: {
        getPoints: async (query) => batchFor(query.points.slice(0, -1)),
      },
    });
    await expect(service.getTransect(baseQuery)).rejects.toThrow("returned 2 points for 3 requested samples");
  });

  it("rejects an omitted member payload when members were explicitly requested", async () => {
    const service = new GefsTransectService({
      pointsGetter: {
        getPoints: async (query) => {
          const batch = batchFor(query.points, true);
          delete batch.points[1]!.members;
          return batch;
        },
      },
    });
    await expect(service.getTransect({ ...baseQuery, includeMembers: true })).rejects.toThrow(
      "member payload was requested but omitted at sample 1",
    );
  });
});
