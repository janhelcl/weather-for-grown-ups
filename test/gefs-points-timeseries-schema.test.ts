import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEFS_POINTS_TIME_SERIES_MAX_SAMPLES,
  DEFAULT_GEFS_POINTS_TIME_SERIES_MAX_STEPS,
  gefsPointsTimeSeriesQuerySchema,
} from "../src/schema/gefs-points-timeseries.js";

const base = {
  points: [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 49.2, longitude: 16.61 },
  ],
  run: "2026-08-24T00:00:00Z",
  startTime: "2026-08-24T03:00:00Z",
  endTime: "2026-08-24T09:00:00Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850,
  members: ["c00", "p01"] as const,
};

describe("GEFS multi-point time-series schema", () => {
  it("applies compact bounded defaults", () => {
    const parsed = gefsPointsTimeSeriesQuerySchema.parse(base);
    expect(parsed.maxSteps).toBe(DEFAULT_GEFS_POINTS_TIME_SERIES_MAX_STEPS);
    expect(parsed.maxSamples).toBe(DEFAULT_GEFS_POINTS_TIME_SERIES_MAX_SAMPLES);
    expect(parsed.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(parsed.includeMembers).toBe(false);
  });

  it("rejects unsupported pressure selections and duplicate ensemble controls", () => {
    expect(() => gefsPointsTimeSeriesQuerySchema.parse({
      ...base,
      pressureLevelHpa: 975,
    })).toThrow("does not publish");

    expect(() => gefsPointsTimeSeriesQuerySchema.parse({
      ...base,
      members: ["c00", "c00"],
    })).toThrow("must not contain duplicates");

    expect(() => gefsPointsTimeSeriesQuerySchema.parse({
      ...base,
      quantiles: [0.5, 0.5],
    })).toThrow("must not contain duplicates");
  });

  it("rejects reversed ranges and excessive point counts", () => {
    expect(() => gefsPointsTimeSeriesQuerySchema.parse({
      ...base,
      startTime: "2026-08-24T09:00:00Z",
      endTime: "2026-08-24T03:00:00Z",
    })).toThrow("endTime must be at or after startTime");

    expect(() => gefsPointsTimeSeriesQuerySchema.parse({
      ...base,
      points: Array.from({ length: 21 }, (_, index) => ({ latitude: 50, longitude: index })),
    })).toThrow();
  });
});
