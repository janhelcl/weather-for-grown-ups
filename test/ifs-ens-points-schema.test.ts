import { describe, expect, it } from "vitest";
import {
  IFS_ENS_POINTS_TIME_SERIES_DEFAULT_MAX_POINT_STEPS,
  IFS_ENS_POINTS_TIME_SERIES_DEFAULT_MAX_STEPS,
  ifsEnsPointsQuerySchema,
  ifsEnsPointsTimeSeriesQuerySchema,
} from "../src/schema/ifs-ens-points.js";

const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.82, longitude: 14.21 },
];

describe("IFS ENS multi-point schema", () => {
  it("defaults to all 50 perturbations and compact summaries", () => {
    const query = ifsEnsPointsQuerySchema.parse({
      points,
      run: "latest",
      validTime: "2026-08-28T12:00:00Z",
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });

    expect(query.members).toHaveLength(50);
    expect(query.members[0]).toBe("p01");
    expect(query.members[49]).toBe("p50");
    expect(query.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(query.includeMembers).toBe(false);
  });

  it("rejects duplicate ensemble selectors and too many points", () => {
    expect(() => ifsEnsPointsQuerySchema.parse({
      points,
      run: "latest",
      validTime: "2026-08-28T12:00:00Z",
      selection: { fields: ["wind_10m"] },
      members: ["p01", "p01"],
    })).toThrow("members must not contain duplicates");

    expect(() => ifsEnsPointsQuerySchema.parse({
      points,
      run: "latest",
      validTime: "2026-08-28T12:00:00Z",
      selection: { fields: ["wind_10m"] },
      members: ["p01", "p02"],
      quantiles: [0.5, 0.5],
    })).toThrow("Quantiles must not contain duplicates");

    expect(() => ifsEnsPointsQuerySchema.parse({
      points: Array.from({ length: 21 }, (_, index) => ({
        latitude: 49 + index * 0.01,
        longitude: 14,
      })),
      run: "latest",
      validTime: "2026-08-28T12:00:00Z",
      selection: { fields: ["wind_10m"] },
    })).toThrow();
  });

  it("bounds multi-point time-series matrices independently of member payloads", () => {
    const query = ifsEnsPointsTimeSeriesQuerySchema.parse({
      points,
      run: "latest",
      startTime: "2026-08-28T00:00:00Z",
      endTime: "2026-08-28T12:00:00Z",
      selection: { fields: ["wind_10m"] },
      members: ["p01", "p02"],
    });

    expect(query.maxSteps).toBe(IFS_ENS_POINTS_TIME_SERIES_DEFAULT_MAX_STEPS);
    expect(query.maxPointSteps).toBe(IFS_ENS_POINTS_TIME_SERIES_DEFAULT_MAX_POINT_STEPS);

    expect(() => ifsEnsPointsTimeSeriesQuerySchema.parse({
      ...query,
      startTime: "2026-08-28T12:00:00Z",
      endTime: "2026-08-28T00:00:00Z",
    })).toThrow("endTime must be at or after startTime");
  });
});
