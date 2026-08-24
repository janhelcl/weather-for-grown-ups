import { describe, expect, it } from "vitest";
import { gefsAreaSummaryQuerySchema } from "../src/schema/gefs-area-summary.js";

const base = {
  westLongitude: 14,
  eastLongitude: 15,
  southLatitude: 49,
  northLatitude: 50,
  run: "2026-08-24T00:00:00Z",
  validTime: "2026-08-24T06:00:00Z",
  members: ["c00", "p01"] as const,
};

describe("GEFS area summary query schema", () => {
  it("accepts a pressure variable and applies defaults", () => {
    const parsed = gefsAreaSummaryQuerySchema.parse({
      ...base,
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    expect(parsed.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(parsed.includeExtremaLocations).toBe(false);
    expect(parsed.includeMembers).toBe(false);
    expect(parsed.maxGridPoints).toBe(12_500);
    expect(parsed.maxMemberGridPoints).toBe(250_000);
  });

  it("accepts a raw non-isobaric field without a pressure selection", () => {
    expect(() => gefsAreaSummaryQuerySchema.parse({
      ...base,
      field: "total_precipitation",
    })).not.toThrow();
  });

  it.each([
    ["eastLongitude", { eastLongitude: 14 }, "eastLongitude must be greater than westLongitude"],
    ["northLatitude", { northLatitude: 49 }, "northLatitude must be greater than southLatitude"],
  ])("rejects invalid bbox geometry at %s", (_name, override, message) => {
    expect(() => gefsAreaSummaryQuerySchema.parse({
      ...base,
      ...override,
      variable: "temperature",
      pressureLevelHpa: 850,
    })).toThrow(message);
  });

  it("rejects mixing a field with pressure-level selection", () => {
    expect(() => gefsAreaSummaryQuerySchema.parse({
      ...base,
      field: "total_precipitation",
      variable: "temperature",
      pressureLevelHpa: 850,
    })).toThrow("accepts either field or variable+pressureLevelHpa, not both");
  });

  it("requires a variable when only a pressure level is supplied", () => {
    expect(() => gefsAreaSummaryQuerySchema.parse({
      ...base,
      pressureLevelHpa: 850,
    })).toThrow("requires variable and pressureLevelHpa together");
  });

  it("requires a pressure level when only a variable is supplied", () => {
    expect(() => gefsAreaSummaryQuerySchema.parse({
      ...base,
      variable: "temperature",
    })).toThrow("requires variable and pressureLevelHpa together");
  });

  it("rejects duplicate members", () => {
    expect(() => gefsAreaSummaryQuerySchema.parse({
      ...base,
      members: ["c00", "c00"],
      variable: "temperature",
      pressureLevelHpa: 850,
    })).toThrow("member selection must not contain duplicates");
  });

  it("rejects duplicate ensemble quantiles", () => {
    expect(() => gefsAreaSummaryQuerySchema.parse({
      ...base,
      quantiles: [0.5, 0.5],
      variable: "temperature",
      pressureLevelHpa: 850,
    })).toThrow("ensemble quantiles must not contain duplicates");
  });

  it("rejects duplicate spatial percentiles", () => {
    expect(() => gefsAreaSummaryQuerySchema.parse({
      ...base,
      percentiles: [50, 50],
      variable: "temperature",
      pressureLevelHpa: 850,
    })).toThrow("spatial percentiles must not contain duplicates");
  });

  it("accepts distinct spatial percentiles", () => {
    expect(() => gefsAreaSummaryQuerySchema.parse({
      ...base,
      percentiles: [10, 50, 90],
      variable: "temperature",
      pressureLevelHpa: 850,
    })).not.toThrow();
  });
});
