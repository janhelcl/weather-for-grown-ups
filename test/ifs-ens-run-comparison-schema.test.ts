import { describe, expect, it } from "vitest";
import { ifsEnsRunComparisonQuerySchema } from "../src/schema/ifs-ens-run-comparison.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  anchorRun: "latest" as const,
  validTime: "2026-08-28T12:00:00Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850 as const,
};

describe("IFS ENS run comparison schema", () => {
  it("defaults to all perturbations, three cycles and six-hour stride", () => {
    const query = ifsEnsRunComparisonQuerySchema.parse(base);
    expect(query.members).toHaveLength(50);
    expect(query.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(query.cycles).toBe(3);
    expect(query.cycleStrideHours).toBe(6);
  });

  it("accepts twelve-hour stride for long-cycle comparison", () => {
    expect(ifsEnsRunComparisonQuerySchema.parse({
      ...base,
      members: ["p01", "p50"],
      cycleStrideHours: 12,
      cycles: 4,
    }).cycleStrideHours).toBe(12);
  });

  it("rejects multi-output wind and duplicate ensemble selectors", () => {
    expect(() => ifsEnsRunComparisonQuerySchema.parse({
      ...base,
      variable: "wind",
    })).toThrow("one numeric scalar output");

    expect(() => ifsEnsRunComparisonQuerySchema.parse({
      ...base,
      members: ["p01", "p01"],
    })).toThrow("members must not contain duplicates");

    expect(() => ifsEnsRunComparisonQuerySchema.parse({
      ...base,
      members: ["p01", "p02"],
      quantiles: [0.5, 0.5],
    })).toThrow("Quantiles must not contain duplicates");
  });
});
