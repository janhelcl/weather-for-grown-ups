import { describe, expect, it } from "vitest";
import {
  quantile,
  summarizeNumericDistribution,
  thresholdGteSummary,
} from "../src/core/ensemble-statistics.js";

describe("shared ensemble statistics", () => {
  it("uses one deterministic mean/spread/quantile implementation", () => {
    expect(summarizeNumericDistribution([0, 2, 4, 6], [0.75, 0.25, 0.5])).toEqual({
      memberCount: 4,
      mean: 3,
      populationStdDev: Math.sqrt(5),
      min: 0,
      max: 6,
      quantiles: [
        { quantile: 0.25, value: 1.5 },
        { quantile: 0.5, value: 3 },
        { quantile: 0.75, value: 4.5 },
      ],
    });
  });

  it("preserves raw threshold-member semantics", () => {
    expect(thresholdGteSummary([0, 2, 4, 6], 3)).toEqual({
      operator: "gte",
      value: 3,
      count: 2,
      fraction: 0.5,
      interpretation: "raw_member_fraction_not_calibrated_probability",
    });
  });

  it("rejects invalid/empty distribution operations", () => {
    expect(() => summarizeNumericDistribution([], [0.5])).toThrow("empty ensemble");
    expect(() => quantile([1, 2], 1.1)).toThrow("between 0 and 1");
  });
});
