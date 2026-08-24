import { describe, expect, it } from "vitest";
import { handleGetGefsAreaSummary } from "../src/mcp-gefs-area-tool.js";
import type { GefsAreaSummaryResult } from "../src/schema/gefs-area-summary.js";

const query = {
  westLongitude: 14,
  eastLongitude: 15,
  southLatitude: 49,
  northLatitude: 50,
  run: "2026-08-24T00:00:00Z",
  validTime: "2026-08-24T06:00:00Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850,
  members: ["c00", "p01"] as const,
  quantiles: [0.5],
};

const distribution = {
  memberCount: 2,
  mean: 1,
  populationStdDev: 1,
  min: 0,
  max: 2,
  quantiles: [{ quantile: 0.5, value: 1 }],
};

const result: GefsAreaSummaryResult = {
  model: "gefs_0p50",
  run: "2026-08-24T00:00:00.000Z",
  validTime: "2026-08-24T06:00:00.000Z",
  forecastHour: 6,
  bbox: { westLongitude: 14, eastLongitude: 15, southLatitude: 49, northLatitude: 50 },
  selection: {
    variable: "temperature",
    pressureLevelHpa: 850,
    outputField: "temperatureC",
    unit: "degC",
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  methodology: "spatial_statistics_per_member_then_ensemble_distribution",
  statistics: {
    definedGridPoints: { ...distribution, mean: 4, populationStdDev: 0, min: 4, max: 4, quantiles: [{ quantile: 0.5, value: 4 }] },
    mean: distribution,
    min: distribution,
    max: distribution,
  },
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    product: "pgrb2a_0p50",
    allCacheHit: true,
  },
};

describe("handleGetGefsAreaSummary", () => {
  it("returns text and structured output", async () => {
    expect(await handleGetGefsAreaSummary({ summarize: async () => result }, query)).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("maps Error failures to MCP errors", async () => {
    expect(await handleGetGefsAreaSummary({ summarize: async () => { throw new Error("too large"); } }, query)).toEqual({
      content: [{ type: "text", text: "too large" }],
      isError: true,
    });
  });

  it("maps non-Error failures to MCP errors", async () => {
    expect(await handleGetGefsAreaSummary({ summarize: async () => { throw "upstream failed"; } }, query)).toEqual({
      content: [{ type: "text", text: "upstream failed" }],
      isError: true,
    });
  });
});
