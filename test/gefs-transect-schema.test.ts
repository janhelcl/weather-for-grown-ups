import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEFS_TRANSECT_SAMPLES,
  MAX_GEFS_TRANSECT_SAMPLES,
  gefsTransectQuerySchema,
} from "../src/schema/gefs-transect.js";

const baseQuery = {
  start: { latitude: 50, longitude: 14 },
  end: { latitude: 48, longitude: 17 },
  run: "latest" as const,
  validTime: "2026-08-24T12:00:00Z",
  selection: { fields: ["temperature_2m"] as ["temperature_2m"] },
  members: ["c00", "p01"] as ["c00", "p01"],
};

describe("GEFS transect schema", () => {
  it("defaults to the proven GEFS multi-point sample bound", () => {
    const query = gefsTransectQuerySchema.parse(baseQuery);
    expect(query.samples).toBe(DEFAULT_GEFS_TRANSECT_SAMPLES);
    expect(MAX_GEFS_TRANSECT_SAMPLES).toBe(20);
    expect(query.includeMembers).toBe(false);
  });

  it("rejects degenerate paths and sample counts beyond the multi-point bound", () => {
    expect(() => gefsTransectQuerySchema.parse({
      ...baseQuery,
      end: baseQuery.start,
    })).toThrow();

    expect(() => gefsTransectQuerySchema.parse({
      ...baseQuery,
      samples: 21,
    })).toThrow();
  });

  it("rejects duplicate member and quantile selections", () => {
    expect(() => gefsTransectQuerySchema.parse({
      ...baseQuery,
      members: ["c00", "c00"],
    })).toThrow("GEFS member selection must not contain duplicates");

    expect(() => gefsTransectQuerySchema.parse({
      ...baseQuery,
      quantiles: [0.5, 0.5],
    })).toThrow("Quantile selection must not contain duplicates");
  });
});
