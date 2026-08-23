import { describe, expect, it } from "vitest";
import {
  DEFAULT_POINTS_TIME_SERIES_MAX_POINTS,
  DEFAULT_POINTS_TIME_SERIES_MAX_SAMPLES,
  DEFAULT_POINTS_TIME_SERIES_MAX_STEPS,
  pointsTimeSeriesQuerySchema,
} from "../src/schema/query.js";

const base = {
  points: [{ latitude: 50.08, longitude: 14.43 }],
  startTime: "2026-08-20T06:00:00Z",
  endTime: "2026-08-20T18:00:00Z",
  fields: ["temperature_2m"] as const,
};

describe("pointsTimeSeriesQuerySchema", () => {
  it("defaults run and response guards", () => {
    const parsed = pointsTimeSeriesQuerySchema.parse(base);
    expect(parsed.run).toBe("latest");
    expect(parsed.maxSteps).toBe(DEFAULT_POINTS_TIME_SERIES_MAX_STEPS);
    expect(parsed.maxSamples).toBe(DEFAULT_POINTS_TIME_SERIES_MAX_SAMPLES);
  });

  it("accepts the maximum default point count", () => {
    const points = Array.from({ length: DEFAULT_POINTS_TIME_SERIES_MAX_POINTS }, (_, index) => ({
      latitude: 40 + index * 0.1,
      longitude: 10,
    }));
    expect(pointsTimeSeriesQuerySchema.parse({ ...base, points }).points).toHaveLength(DEFAULT_POINTS_TIME_SERIES_MAX_POINTS);
  });

  it("rejects more than twenty points", () => {
    const points = Array.from({ length: DEFAULT_POINTS_TIME_SERIES_MAX_POINTS + 1 }, (_, index) => ({
      latitude: 40 + index * 0.1,
      longitude: 10,
    }));
    expect(() => pointsTimeSeriesQuerySchema.parse({ ...base, points })).toThrow();
  });

  it("requires pressure-level variables and pressure levels together", () => {
    expect(() => pointsTimeSeriesQuerySchema.parse({
      points: base.points,
      startTime: base.startTime,
      endTime: base.endTime,
      variables: ["temperature"],
    })).toThrow(/pressureLevelsHpa/i);
  });

  it("requires at least one atmospheric selection", () => {
    expect(() => pointsTimeSeriesQuerySchema.parse({
      points: base.points,
      startTime: base.startTime,
      endTime: base.endTime,
    })).toThrow(/Request at least one/);
  });

  it("allows an explicit larger matrix guard up to 5000 point-steps", () => {
    expect(pointsTimeSeriesQuerySchema.parse({ ...base, maxSamples: 5_000 }).maxSamples).toBe(5_000);
    expect(() => pointsTimeSeriesQuerySchema.parse({ ...base, maxSamples: 5_001 })).toThrow();
  });
});
