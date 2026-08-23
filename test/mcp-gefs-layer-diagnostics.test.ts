import { describe, expect, it } from "vitest";
import { handleGetGefsLayerDiagnostics } from "../src/mcp-gefs-tool.js";
import type { GefsLayerDiagnosticsResult } from "../src/schema/gefs-layer-diagnostics.js";

const result: GefsLayerDiagnosticsResult = {
  model: "gefs_0p50",
  run: "2026-08-23T12:00:00Z",
  validTime: "2026-08-23T18:00:00Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  pressureLayer: { lowerPressureHpa: 850, upperPressureHpa: 500 },
  selection: {
    diagnostics: ["temperature_lapse_rate"],
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  layerDepthGpm: {
    memberCount: 2,
    mean: 4000,
    populationStdDev: 10,
    min: 3990,
    max: 4010,
    quantiles: [{ quantile: 0.5, value: 4000 }],
  },
  summaries: [{
    id: "temperature_lapse_rate",
    field: "temperatureLapseRateCPerKm",
    unit: "degC/km",
    distribution: {
      memberCount: 2,
      mean: 5,
      populationStdDev: 0.2,
      min: 4.8,
      max: 5.2,
      quantiles: [{ quantile: 0.5, value: 5 }],
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
  lowerPressureHpa: 850,
  upperPressureHpa: 500,
  diagnostics: ["temperature_lapse_rate"] as const,
  members: ["c00", "p01"] as const,
  quantiles: [0.5],
};

describe("handleGetGefsLayerDiagnostics", () => {
  it("returns ensemble diagnostic distributions as structured MCP content", async () => {
    const response = await handleGetGefsLayerDiagnostics({ getLayerDiagnostics: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("turns diagnostic failures into MCP tool errors", async () => {
    const response = await handleGetGefsLayerDiagnostics({
      getLayerDiagnostics: async () => { throw new Error("diagnostic failed"); },
    }, query);
    expect(response).toEqual({ content: [{ type: "text", text: "diagnostic failed" }], isError: true });
  });
});
