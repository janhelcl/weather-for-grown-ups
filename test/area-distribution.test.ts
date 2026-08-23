import { describe, expect, it } from "vitest";
import { computeAreaDistribution, linearPercentile } from "../src/core/area-distribution.js";

const points = [
  { longitude: 10, latitude: 50, value: 0 },
  { longitude: 11, latitude: 50, value: 10 },
  { longitude: 12, latitude: 50, value: 20 },
  { longitude: 13, latitude: 50, value: 20 },
];

describe("linearPercentile", () => {
  it("uses linear interpolation over sorted defined grid points", () => {
    expect(linearPercentile([0, 10, 20, 30], 0)).toBe(0);
    expect(linearPercentile([0, 10, 20, 30], 25)).toBe(7.5);
    expect(linearPercentile([0, 10, 20, 30], 50)).toBe(15);
    expect(linearPercentile([0, 10, 20, 30], 100)).toBe(30);
  });

  it("handles one value and rejects invalid inputs", () => {
    expect(linearPercentile([5], 73)).toBe(5);
    expect(() => linearPercentile([], 50)).toThrow(/at least one/);
    expect(() => linearPercentile([1, 2], 101)).toThrow(/between 0 and 100/);
  });
});

describe("computeAreaDistribution", () => {
  it("computes base statistics, percentiles, threshold fractions, and extrema with ties", () => {
    expect(computeAreaDistribution(points, {
      percentiles: [25, 50, 90],
      thresholds: [
        { operator: "gte", value: 20 },
        { operator: "lte", value: 10 },
      ],
      includeExtremaLocations: true,
    })).toEqual({
      statistics: {
        definedGridPoints: 4,
        mean: 12.5,
        min: 0,
        max: 20,
      },
      distribution: {
        percentileMethod: "linear_interpolation_sorted_defined_grid_points",
        percentiles: [
          { percentile: 25, value: 7.5 },
          { percentile: 50, value: 15 },
          { percentile: 90, value: 20 },
        ],
        thresholdFractions: [
          { operator: "gte", threshold: 20, matchingGridPoints: 2, fraction: 0.5 },
          { operator: "lte", threshold: 10, matchingGridPoints: 2, fraction: 0.5 },
        ],
        extrema: {
          min: { value: 0, gridPoint: { latitude: 50, longitude: 10 }, tiedGridPoints: 1 },
          max: { value: 20, gridPoint: { latitude: 50, longitude: 12 }, tiedGridPoints: 2 },
        },
      },
    });
  });

  it("returns only requested distribution sections", () => {
    expect(computeAreaDistribution(points, {
      thresholds: [{ operator: "gte", value: 100 }],
      includeExtremaLocations: false,
    }).distribution).toEqual({
      thresholdFractions: [
        { operator: "gte", threshold: 100, matchingGridPoints: 0, fraction: 0 },
      ],
    });
  });

  it("fails clearly on an empty defined grid", () => {
    expect(() => computeAreaDistribution([], { includeExtremaLocations: true })).toThrow(/at least one defined/);
  });
});
