import { describe, expect, it } from "vitest";
import {
  DEFAULT_IFS_ENS_AREA_MAX_GRID_POINTS,
  DEFAULT_IFS_ENS_AREA_MAX_MEMBER_GRID_POINTS,
  ifsEnsAreaSummaryQuerySchema,
} from "../src/schema/ifs-ens-area-summary.js";

const base = {
  westLongitude: 14,
  eastLongitude: 14.5,
  southLatitude: 49.5,
  northLatitude: 50,
  run: "latest" as const,
  validTime: "2026-08-28T12:00:00Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850 as const,
};

describe("IFS ENS area summary schema", () => {
  it("defaults to all perturbations with bounded member-grid work", () => {
    const query = ifsEnsAreaSummaryQuerySchema.parse(base);
    expect(query.members).toHaveLength(50);
    expect(query.members[0]).toBe("p01");
    expect(query.members[49]).toBe("p50");
    expect(query.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(query.maxGridPoints).toBe(DEFAULT_IFS_ENS_AREA_MAX_GRID_POINTS);
    expect(query.maxMemberGridPoints).toBe(DEFAULT_IFS_ENS_AREA_MAX_MEMBER_GRID_POINTS);
  });

  it("accepts one raw field instead of pressure selection", () => {
    const query = ifsEnsAreaSummaryQuerySchema.parse({
      ...base,
      variable: undefined,
      pressureLevelHpa: undefined,
      field: "total_precipitation",
      members: ["p01", "p50"],
    });
    expect(query.field).toBe("total_precipitation");
  });

  it("rejects mixed scalar selections and duplicate ensemble controls", () => {
    expect(() => ifsEnsAreaSummaryQuerySchema.parse({
      ...base,
      field: "temperature_2m",
    })).toThrow("either field or variable+pressureLevelHpa");

    expect(() => ifsEnsAreaSummaryQuerySchema.parse({
      ...base,
      members: ["p01", "p01"],
    })).toThrow("members must not contain duplicates");

    expect(() => ifsEnsAreaSummaryQuerySchema.parse({
      ...base,
      members: ["p01", "p02"],
      quantiles: [0.5, 0.5],
    })).toThrow("Quantiles must not contain duplicates");
  });

  it("rejects invalid boxes and duplicate spatial percentiles", () => {
    expect(() => ifsEnsAreaSummaryQuerySchema.parse({
      ...base,
      eastLongitude: 13,
    })).toThrow("eastLongitude must be greater");

    expect(() => ifsEnsAreaSummaryQuerySchema.parse({
      ...base,
      percentiles: [50, 50],
    })).toThrow("Area percentiles must be unique");
  });
});
