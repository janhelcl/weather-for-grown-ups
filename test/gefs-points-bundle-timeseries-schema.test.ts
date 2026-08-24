import { describe, expect, it } from "vitest";
import {
  GEFS_POINTS_BUNDLE_TIME_SERIES_DEFAULT_MAX_POINT_STEPS,
  GEFS_POINTS_BUNDLE_TIME_SERIES_DEFAULT_MAX_STEPS,
  gefsPointsBundleTimeSeriesQuerySchema,
} from "../src/schema/gefs-points-bundle-timeseries.js";

describe("GEFS multi-point bundle time-series schema", () => {
  it("applies bounded defaults for compact agent responses", () => {
    const query = gefsPointsBundleTimeSeriesQuerySchema.parse({
      points: [{ latitude: 50.08, longitude: 14.43 }],
      run: "latest",
      startTime: "2026-08-24T00:00:00Z",
      endTime: "2026-08-24T06:00:00Z",
      selection: { fields: ["temperature_2m"] },
      members: ["c00", "p01"],
    });

    expect(query.maxSteps).toBe(GEFS_POINTS_BUNDLE_TIME_SERIES_DEFAULT_MAX_STEPS);
    expect(query.maxPointSteps).toBe(GEFS_POINTS_BUNDLE_TIME_SERIES_DEFAULT_MAX_POINT_STEPS);
    expect(query.includeMembers).toBe(false);
    expect(query.quantiles).toEqual([0.1, 0.5, 0.9]);
  });

  it("rejects reversed ranges and duplicate member/quantile selections", () => {
    expect(() => gefsPointsBundleTimeSeriesQuerySchema.parse({
      points: [{ latitude: 50.08, longitude: 14.43 }],
      run: "latest",
      startTime: "2026-08-24T06:00:00Z",
      endTime: "2026-08-24T00:00:00Z",
      selection: { fields: ["temperature_2m"] },
      members: ["c00", "c00"],
      quantiles: [0.5, 0.5],
    })).toThrow();
  });
});
