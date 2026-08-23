import { describe, expect, it } from "vitest";
import { DEFAULT_TRANSECT_SAMPLES, MAX_TRANSECT_SAMPLES, transectQuerySchema } from "../src/schema/transect.js";

const base = {
  start: { latitude: 50, longitude: 10 },
  end: { latitude: 50, longitude: 20 },
  validTime: "2026-08-24T12:00:00Z",
  variables: ["temperature", "wind"] as const,
  pressureLevelsHpa: [850, 700],
};

describe("transectQuerySchema", () => {
  it("defaults to latest and 21 samples", () => {
    const parsed = transectQuerySchema.parse(base);
    expect(parsed.run).toBe("latest");
    expect(parsed.samples).toBe(DEFAULT_TRANSECT_SAMPLES);
    expect(DEFAULT_TRANSECT_SAMPLES).toBe(21);
    expect(MAX_TRANSECT_SAMPLES).toBe(50);
  });

  it("accepts explicit run and derived pressure variables", () => {
    expect(transectQuerySchema.safeParse({
      ...base,
      run: "2026-08-24T06:00:00Z",
      variables: ["wet_bulb_temperature", "equivalent_potential_temperature"],
      samples: 50,
    }).success).toBe(true);
  });

  it("rejects identical endpoints", () => {
    expect(transectQuerySchema.safeParse({ ...base, end: base.start }).success).toBe(false);
  });

  it("bounds sample count and requires explicit pressure selection", () => {
    expect(transectQuerySchema.safeParse({ ...base, samples: 1 }).success).toBe(false);
    expect(transectQuerySchema.safeParse({ ...base, samples: 51 }).success).toBe(false);
    expect(transectQuerySchema.safeParse({ ...base, variables: [] }).success).toBe(false);
    expect(transectQuerySchema.safeParse({ ...base, pressureLevelsHpa: [] }).success).toBe(false);
  });

  it("rejects unpublished pressure surfaces and invalid coordinates", () => {
    expect(transectQuerySchema.safeParse({ ...base, pressureLevelsHpa: [842] }).success).toBe(false);
    expect(transectQuerySchema.safeParse({ ...base, start: { latitude: 91, longitude: 10 } }).success).toBe(false);
  });
});
