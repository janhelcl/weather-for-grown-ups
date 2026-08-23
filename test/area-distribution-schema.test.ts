import { describe, expect, it } from "vitest";
import {
  areaSummaryQuerySchema,
  MAX_AREA_PERCENTILES,
  MAX_AREA_THRESHOLDS,
} from "../src/schema/area-summary.js";
import { areaSummaryResultSchema } from "../src/schema/area-summary-result.js";

const base = {
  westLongitude: 12,
  eastLongitude: 18,
  southLatitude: 48,
  northLatitude: 51,
  validTime: "2026-08-24T12:00:00Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850,
};

describe("rich area summary query schema", () => {
  it("keeps rich statistics opt-in", () => {
    expect(areaSummaryQuerySchema.parse(base)).toMatchObject({
      ...base,
      run: "latest",
      includeExtremaLocations: false,
    });
  });

  it("accepts normalized-unit percentile, threshold, and extrema requests", () => {
    expect(areaSummaryQuerySchema.safeParse({
      ...base,
      percentiles: [10, 50, 90],
      thresholds: [
        { operator: "gte", value: 15 },
        { operator: "lte", value: 0 },
      ],
      includeExtremaLocations: true,
    }).success).toBe(true);
  });

  it("rejects duplicate/out-of-range percentiles and oversized option lists", () => {
    expect(areaSummaryQuerySchema.safeParse({ ...base, percentiles: [50, 50] }).success).toBe(false);
    expect(areaSummaryQuerySchema.safeParse({ ...base, percentiles: [-1] }).success).toBe(false);
    expect(areaSummaryQuerySchema.safeParse({ ...base, percentiles: Array(MAX_AREA_PERCENTILES + 1).fill(50) }).success).toBe(false);
    expect(areaSummaryQuerySchema.safeParse({
      ...base,
      thresholds: Array.from({ length: MAX_AREA_THRESHOLDS + 1 }, (_, value) => ({ operator: "gte", value })),
    }).success).toBe(false);
  });
});

describe("rich area summary result schema", () => {
  const result = {
    model: "gfs_0p25",
    run: "2026-08-24T06:00:00.000Z",
    validTime: "2026-08-24T12:00:00.000Z",
    forecastHour: 6,
    bbox: { westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51 },
    variable: { id: "temperature", pressureHpa: 850, field: "temperatureC", unit: "degC" },
    statistics: { definedGridPoints: 4, mean: 10, min: 0, max: 20, meanKind: "unweighted_grid_point_mean" },
    source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false },
  } as const;

  it("accepts an omitted distribution for backwards-compatible default calls", () => {
    expect(areaSummaryResultSchema.safeParse(result).success).toBe(true);
  });

  it("requires percentile method when percentile results are present", () => {
    expect(areaSummaryResultSchema.safeParse({
      ...result,
      distribution: { percentiles: [{ percentile: 50, value: 10 }] },
    }).success).toBe(false);
    expect(areaSummaryResultSchema.safeParse({
      ...result,
      distribution: {
        percentileMethod: "linear_interpolation_sorted_defined_grid_points",
        percentiles: [{ percentile: 50, value: 10 }],
      },
    }).success).toBe(true);
  });
});
