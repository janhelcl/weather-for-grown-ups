import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_COMPARISON_CYCLES,
  MAX_RUN_COMPARISON_CYCLES,
  runComparisonQuerySchema,
} from "../src/schema/query.js";
import { runComparisonResultSchema } from "../src/schema/run-comparison-result.js";

const baseQuery = {
  latitude: 50.08,
  longitude: 14.43,
  anchorRun: "latest" as const,
  validTime: "2026-08-20T12:00:00Z",
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
};

const snapshot = (run: string, forecastHour: number) => ({
  run,
  forecastHour,
  levels: [{ pressureHpa: 850, temperatureC: 10 }],
  cacheHit: false,
});

const transition = {
  fromRun: "2026-08-19T06:00:00.000Z",
  toRun: "2026-08-19T12:00:00.000Z",
  fromForecastHour: 30,
  toForecastHour: 24,
  pressureLevels: [{
    pressureHpa: 850,
    changes: [{ field: "temperatureC", from: 9, to: 10, delta: 1, deltaKind: "linear" as const }],
  }],
  fields: [],
};

describe("runComparisonQuerySchema", () => {
  it("defaults to three cycles", () => {
    expect(runComparisonQuerySchema.parse(baseQuery).cycles).toBe(DEFAULT_RUN_COMPARISON_CYCLES);
  });

  it("requires at least two and at most six cycles", () => {
    expect(runComparisonQuerySchema.safeParse({ ...baseQuery, cycles: 1 }).success).toBe(false);
    expect(runComparisonQuerySchema.safeParse({ ...baseQuery, cycles: MAX_RUN_COMPARISON_CYCLES + 1 }).success).toBe(false);
  });

  it("inherits atmospheric selection validation", () => {
    expect(runComparisonQuerySchema.safeParse({
      latitude: 50,
      longitude: 14,
      anchorRun: "latest",
      validTime: "2026-08-20T12:00:00Z",
    }).success).toBe(false);
  });
});

describe("runComparisonResultSchema", () => {
  const valid = {
    model: "gfs_0p25" as const,
    validTime: "2026-08-20T12:00:00.000Z",
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    anchorRun: "2026-08-19T12:00:00.000Z",
    source: { provider: "NOAA AWS Open Data" as const, access: "s3_range" as const, decoder: "wgrib2" as const },
    runs: [
      snapshot("2026-08-19T06:00:00.000Z", 30),
      snapshot("2026-08-19T12:00:00.000Z", 24),
    ],
    comparisons: [transition],
  };

  it("accepts a coherent run comparison", () => {
    expect(runComparisonResultSchema.parse(valid)).toEqual(valid);
  });

  it("requires one transition per adjacent run pair", () => {
    expect(runComparisonResultSchema.safeParse({ ...valid, comparisons: [] }).success).toBe(false);
  });

  it("requires the anchor to be the newest returned run", () => {
    expect(runComparisonResultSchema.safeParse({ ...valid, anchorRun: "2026-08-19T06:00:00.000Z" }).success).toBe(false);
  });

  it("rejects numeric deltas for non-comparable fields", () => {
    const bad = structuredClone(valid);
    bad.comparisons[0]!.fields = [{
      id: "total_precipitation",
      comparable: false,
      reason: "temporal_windows_differ",
      changes: [{ field: "precipitationMm", from: 1, to: 2, delta: 1, deltaKind: "linear" }],
    }];
    expect(runComparisonResultSchema.safeParse(bad).success).toBe(false);
  });
});
