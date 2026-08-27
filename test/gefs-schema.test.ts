import { describe, expect, it } from "vitest";
import { GEFS_MEMBERS } from "../src/catalog/gefs.js";
import { gefsEnsembleQuerySchema, gefsEnsembleResultSchema } from "../src/schema/gefs-ensemble.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-23T12:00:00Z",
  validTime: "2026-08-23T18:00:00Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850,
};

describe("GEFS ensemble schema", () => {
  it("defaults to all 31 members and standard quantiles", () => {
    const parsed = gefsEnsembleQuerySchema.parse(base);
    expect(parsed.members).toEqual(GEFS_MEMBERS);
    expect(parsed.quantiles).toEqual([0.1, 0.5, 0.9]);
  });

  it("enforces the published variable-specific pgrb2a pressure surface", () => {
    expect(() => gefsEnsembleQuerySchema.parse({ ...base, pressureLevelHpa: 300 })).toThrow("does not publish temperature at 300 hPa");
    expect(gefsEnsembleQuerySchema.parse({ ...base, variable: "u_wind", pressureLevelHpa: 300 }).pressureLevelHpa).toBe(300);
  });

  it("rejects duplicate members and quantiles", () => {
    expect(() => gefsEnsembleQuerySchema.parse({ ...base, members: ["c00", "c00"] })).toThrow("must not contain duplicates");
    expect(() => gefsEnsembleQuerySchema.parse({ ...base, quantiles: [0.5, 0.5] })).toThrow("must not contain duplicates");
  });

  it("accepts the public result contract including explicit raw-member threshold semantics", () => {
    expect(() => gefsEnsembleResultSchema.parse({
      model: "gefs_0p50",
      run: "2026-08-23T12:00:00.000Z",
      validTime: "2026-08-23T18:00:00.000Z",
      forecastHour: 6,
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      selection: { variable: "temperature", gfsCode: "TMP", pressureLevelHpa: 850, outputField: "temperatureC", unit: "degC" },
      members: [
        { member: "c00", value: 10, cacheHit: false },
        { member: "p01", value: 12, cacheHit: true },
      ],
      summary: {
        memberCount: 2,
        mean: 11,
        populationStdDev: 1,
        min: 10,
        max: 12,
        quantiles: [{ quantile: 0.5, value: 11 }],
        threshold: { operator: "gte", value: 11, count: 1, fraction: 0.5, interpretation: "raw_member_fraction_not_calibrated_probability" },
      },
      source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", product: "pgrb2a_0p50", horizontalGridDegrees: 0.5, allCacheHit: false },
    })).not.toThrow();
  });
});
