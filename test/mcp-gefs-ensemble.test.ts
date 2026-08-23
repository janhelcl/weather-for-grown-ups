import { describe, expect, it } from "vitest";
import { handleGetGefsEnsemble } from "../src/mcp-gefs-tool.js";
import type { GefsEnsembleResult } from "../src/schema/gefs-ensemble.js";

const result: GefsEnsembleResult = {
  model: "gefs_0p50",
  run: "2026-08-23T12:00:00.000Z",
  validTime: "2026-08-23T18:00:00.000Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: { variable: "temperature", gfsCode: "TMP", pressureLevelHpa: 850, outputField: "temperatureC", unit: "degC" },
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

describe("handleGetGefsEnsemble", () => {
  it("returns the GEFS result as structured MCP content", async () => {
    const response = await handleGetGefsEnsemble({ getEnsemble: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("turns ensemble failures into MCP tool errors", async () => {
    const response = await handleGetGefsEnsemble({ getEnsemble: async () => { throw new Error("ensemble failed"); } }, query);
    expect(response).toEqual({ content: [{ type: "text", text: "ensemble failed" }], isError: true });
  });
});
