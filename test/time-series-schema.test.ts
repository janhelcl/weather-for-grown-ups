import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_SERIES_MAX_STEPS,
  GFS_TOTAL_NATIVE_FORECAST_STEPS,
  timeSeriesQuerySchema,
} from "../src/schema/query.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  startTime: "2026-08-19T06:00:00Z",
  endTime: "2026-08-20T06:00:00Z",
  variables: ["temperature", "wind"],
  pressureLevelsHpa: [850, 700],
};

describe("timeSeriesQuerySchema", () => {
  it("defaults to latest run, S3 source, and the bounded step guard", () => {
    expect(timeSeriesQuerySchema.parse(base)).toEqual({
      ...base,
      run: "latest",
      source: "s3",
      maxSteps: DEFAULT_TIME_SERIES_MAX_STEPS,
    });
  });

  it("allows explicit NOMADS and explicit model runs", () => {
    expect(
      timeSeriesQuerySchema.parse({ ...base, run: "2026-08-19T06:00:00Z", source: "nomads" }),
    ).toMatchObject({ run: "2026-08-19T06:00:00Z", source: "nomads" });
  });

  it("keeps the max-step hard ceiling equal to the full model output count", () => {
    expect(GFS_TOTAL_NATIVE_FORECAST_STEPS).toBe(209);
    expect(timeSeriesQuerySchema.safeParse({ ...base, maxSteps: 209 }).success).toBe(true);
    expect(timeSeriesQuerySchema.safeParse({ ...base, maxSteps: 210 }).success).toBe(false);
  });

  it.each([0, -1, 1.5])("rejects invalid maxSteps %s", (maxSteps) => {
    expect(timeSeriesQuerySchema.safeParse({ ...base, maxSteps }).success).toBe(false);
  });

  it("applies the same coordinate, variable, level, and timezone validation as profiles", () => {
    expect(timeSeriesQuerySchema.safeParse({ ...base, latitude: 91 }).success).toBe(false);
    expect(timeSeriesQuerySchema.safeParse({ ...base, variables: [] }).success).toBe(false);
    expect(timeSeriesQuerySchema.safeParse({ ...base, pressureLevelsHpa: [0] }).success).toBe(false);
    expect(timeSeriesQuerySchema.safeParse({ ...base, startTime: "2026-08-19T06:00:00" }).success).toBe(false);
  });
});
