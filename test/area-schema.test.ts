import { describe, expect, it } from "vitest";
import { areaSummaryQuerySchema, DEFAULT_AREA_MAX_GRID_POINTS } from "../src/schema/query.js";

const base = {
  westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
  validTime: "2026-08-20T12:00:00Z", variable: "temperature", pressureLevelHpa: 850,
};

const fieldBase = {
  westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
  validTime: "2026-08-20T12:00:00Z", field: "temperature_2m",
};

describe("areaSummaryQuerySchema", () => {
  it("defaults to latest and a bounded grid-point guard for pressure-level selection", () => {
    expect(areaSummaryQuerySchema.parse(base)).toEqual({ ...base, run: "latest", maxGridPoints: DEFAULT_AREA_MAX_GRID_POINTS });
    expect(DEFAULT_AREA_MAX_GRID_POINTS).toBe(50_000);
  });

  it("accepts raw pressure variables but rejects derived pressure wind", () => {
    expect(areaSummaryQuerySchema.safeParse({ ...base, variable: "absolute_vorticity" }).success).toBe(true);
    expect(areaSummaryQuerySchema.safeParse({ ...base, variable: "wind" }).success).toBe(false);
  });

  it("accepts raw non-isobaric fields without a pressure level", () => {
    expect(areaSummaryQuerySchema.parse(fieldBase)).toEqual({
      ...fieldBase,
      run: "latest",
      maxGridPoints: DEFAULT_AREA_MAX_GRID_POINTS,
    });
    expect(areaSummaryQuerySchema.safeParse({ ...fieldBase, field: "low_cloud_cover_average" }).success).toBe(true);
    expect(areaSummaryQuerySchema.safeParse({ ...fieldBase, field: "total_precipitation" }).success).toBe(true);
  });

  it("rejects derived non-isobaric wind fields", () => {
    const parsed = areaSummaryQuerySchema.safeParse({ ...fieldBase, field: "wind_10m" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toMatch(/raw non-isobaric fields only/);
  });

  it("rejects mixing pressure-level and non-isobaric field selectors", () => {
    expect(areaSummaryQuerySchema.safeParse({ ...base, field: "temperature_2m" }).success).toBe(false);
  });

  it("rejects an incomplete pressure-level selector", () => {
    const { pressureLevelHpa: _pressure, ...withoutPressure } = base;
    const { variable: _variable, ...withoutVariable } = base;
    expect(areaSummaryQuerySchema.safeParse(withoutPressure).success).toBe(false);
    expect(areaSummaryQuerySchema.safeParse(withoutVariable).success).toBe(false);
  });

  it("accepts published fractional pressure levels", () => {
    expect(areaSummaryQuerySchema.safeParse({ ...base, pressureLevelHpa: 0.1 }).success).toBe(true);
  });

  it("rejects unpublished pressure levels", () => {
    expect(areaSummaryQuerySchema.safeParse({ ...base, pressureLevelHpa: 842 }).success).toBe(false);
  });

  it("requires west < east and currently rejects antimeridian-crossing boxes", () => {
    expect(areaSummaryQuerySchema.safeParse({ ...base, westLongitude: 20, eastLongitude: 10 }).success).toBe(false);
    expect(areaSummaryQuerySchema.safeParse({ ...base, westLongitude: 170, eastLongitude: -170 }).success).toBe(false);
  });

  it("requires south < north", () => {
    expect(areaSummaryQuerySchema.safeParse({ ...base, southLatitude: 51, northLatitude: 48 }).success).toBe(false);
  });

  it("validates geographic and max-grid-point bounds", () => {
    expect(areaSummaryQuerySchema.safeParse({ ...base, westLongitude: -181 }).success).toBe(false);
    expect(areaSummaryQuerySchema.safeParse({ ...base, northLatitude: 91 }).success).toBe(false);
    expect(areaSummaryQuerySchema.safeParse({ ...base, maxGridPoints: 0 }).success).toBe(false);
  });
});
