import { describe, expect, it } from "vitest";
import { batchPointsQuerySchema, DEFAULT_BATCH_MAX_POINTS } from "../src/schema/query.js";

const selection = {
  validTime: "2026-08-19T12:00:00Z",
  variables: ["temperature"],
  pressureLevelsHpa: [850],
};

describe("batchPointsQuerySchema", () => {
  it("accepts multiple valid points and defaults to query-aware latest", () => {
    const parsed = batchPointsQuerySchema.parse({
      ...selection,
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 45.8, longitude: 11.7 },
      ],
    });
    expect(parsed.run).toBe("latest");
    expect(parsed.points).toHaveLength(2);
  });

  it("requires at least one point", () => {
    expect(batchPointsQuerySchema.safeParse({ ...selection, points: [] }).success).toBe(false);
  });

  it("caps batches at 50 points", () => {
    expect(DEFAULT_BATCH_MAX_POINTS).toBe(50);
    expect(batchPointsQuerySchema.safeParse({
      ...selection,
      points: Array.from({ length: 51 }, () => ({ latitude: 50, longitude: 14 })),
    }).success).toBe(false);
  });

  it("validates every coordinate", () => {
    expect(batchPointsQuerySchema.safeParse({
      ...selection,
      points: [{ latitude: 91, longitude: 14 }],
    }).success).toBe(false);
  });
});
