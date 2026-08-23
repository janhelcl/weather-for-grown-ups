import { describe, expect, it } from "vitest";
import { handleCompareGfsToGefs } from "../src/mcp-model-comparison-tool.js";
import type { GfsGefsComparisonResult } from "../src/schema/gfs-gefs-comparison.js";

const result: GfsGefsComparisonResult = {
  run: "2026-08-23T12:00:00.000Z",
  validTime: "2026-08-23T18:00:00.000Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  selection: { variable: "temperature", gfsCode: "TMP", pressureLevelHpa: 850, outputField: "temperatureC", unit: "degC" },
  deterministicGfs: {
    model: "gfs_0p25",
    gridPoint: { latitude: 50, longitude: 14.5 },
    value: 11,
    source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", cacheHit: true },
  },
  gefs: {
    model: "gefs_0p50",
    gridPoint: { latitude: 50, longitude: 14.5 },
    members: [
      { member: "c00", value: 10, cacheHit: true },
      { member: "p01", value: 12, cacheHit: true },
    ],
    summary: {
      memberCount: 2,
      mean: 11,
      populationStdDev: 1,
      min: 10,
      max: 12,
      quantiles: [{ quantile: 0.5, value: 11 }],
    },
    source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", product: "pgrb2a_0p50", allCacheHit: true },
  },
  comparison: {
    deterministicMinusEnsembleMean: 0,
    standardizedDifference: 0,
    membersBelowDeterministic: 1,
    membersAtOrBelowDeterministic: 1,
    fractionMembersBelowDeterministic: 0.5,
    fractionMembersAtOrBelowDeterministic: 0.5,
    rangePosition: "within_member_range",
    outsideMemberRange: false,
    interpretation: "raw_model_vs_raw_ensemble_distribution_not_calibrated_uncertainty",
  },
};

const query = {
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  validTime: result.validTime,
  variable: "temperature" as const,
  pressureLevelHpa: 850,
  members: ["c00", "p01"] as const,
  quantiles: [0.5],
};

describe("handleCompareGfsToGefs", () => {
  it("returns comparison data as structured MCP content", async () => {
    const response = await handleCompareGfsToGefs({ compare: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("turns comparison failures into MCP tool errors", async () => {
    const response = await handleCompareGfsToGefs({ compare: async () => { throw new Error("comparison failed"); } }, query);
    expect(response).toEqual({ content: [{ type: "text", text: "comparison failed" }], isError: true });
  });
});
