import { describe, expect, it } from "vitest";
import { handleGetGefsProfileDiagnostics } from "../src/mcp-gefs-tool.js";
import type { GefsProfileDiagnosticsResult } from "../src/schema/gefs-profile-diagnostics.js";

const result: GefsProfileDiagnosticsResult = {
  model: "gefs_0p50",
  run: "2026-08-23T12:00:00Z",
  validTime: "2026-08-23T18:00:00Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  sampledPressureLevelsHpa: [1000, 925, 850, 700, 500],
  selection: {
    diagnostics: ["freezing_level_crossings"],
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  summaries: [{
    id: "freezing_level_crossings",
    membersWithAnyCrossing: {
      count: 1,
      memberCount: 2,
      fraction: 0.5,
      interpretation: "raw_member_fraction_not_calibrated_probability",
    },
    crossingCount: {
      memberCount: 2,
      mean: 0.5,
      populationStdDev: 0.5,
      min: 0,
      max: 1,
      quantiles: [{ quantile: 0.5, value: 0.5 }],
    },
    lowestCrossing: {
      contributingMemberCount: 1,
      geopotentialHeightGpm: {
        memberCount: 1,
        mean: 1800,
        populationStdDev: 0,
        min: 1800,
        max: 1800,
        quantiles: [{ quantile: 0.5, value: 1800 }],
      },
      pressureHpa: {
        memberCount: 1,
        mean: 820,
        populationStdDev: 0,
        min: 820,
        max: 820,
        quantiles: [{ quantile: 0.5, value: 820 }],
      },
    },
    highestCrossing: {
      contributingMemberCount: 1,
      geopotentialHeightGpm: {
        memberCount: 1,
        mean: 1800,
        populationStdDev: 0,
        min: 1800,
        max: 1800,
        quantiles: [{ quantile: 0.5, value: 1800 }],
      },
      pressureHpa: {
        memberCount: 1,
        mean: 820,
        populationStdDev: 0,
        min: 820,
        max: 820,
        quantiles: [{ quantile: 0.5, value: 820 }],
      },
    },
  }],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    product: "pgrb2a_0p50",
    allCacheHit: true,
  },
};

const query = {
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  validTime: result.validTime,
  pressureLevelsHpa: [1000, 925, 850, 700, 500],
  diagnostics: ["freezing_level_crossings"] as const,
  members: ["c00", "p01"] as const,
  quantiles: [0.5],
};

describe("handleGetGefsProfileDiagnostics", () => {
  it("returns ensemble structural diagnostics as structured MCP content", async () => {
    const response = await handleGetGefsProfileDiagnostics({ getProfileDiagnostics: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("turns profile diagnostic failures into MCP tool errors", async () => {
    const response = await handleGetGefsProfileDiagnostics({
      getProfileDiagnostics: async () => { throw new Error("profile diagnostic failed"); },
    }, query);
    expect(response).toEqual({ content: [{ type: "text", text: "profile diagnostic failed" }], isError: true });
  });
});
