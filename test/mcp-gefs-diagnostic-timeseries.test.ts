import { describe, expect, it } from "vitest";
import { handleGetGefsDiagnosticTimeSeries } from "../src/mcp-gefs-tool.js";
import type { GefsDiagnosticTimeSeriesResult } from "../src/schema/gefs-diagnostic-timeseries.js";

const distribution = {
  memberCount: 2,
  mean: 6,
  populationStdDev: 0.2,
  min: 5.8,
  max: 6.2,
  quantiles: [{ quantile: 0.5, value: 6 }],
};

const result: GefsDiagnosticTimeSeriesResult = {
  model: "gefs_0p50",
  run: "2026-08-23T12:00:00Z",
  startTime: "2026-08-23T15:00:00Z",
  endTime: "2026-08-23T18:00:00Z",
  stepHours: 3,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    diagnostic: {
      kind: "layer",
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate"],
    },
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  series: [{
    kind: "layer",
    validTime: "2026-08-23T15:00:00Z",
    forecastHour: 3,
    pressureLayer: { lowerPressureHpa: 850, upperPressureHpa: 500 },
    layerDepthGpm: { ...distribution, mean: 4000, min: 3999.8, max: 4000.2 },
    summaries: [{
      id: "temperature_lapse_rate",
      field: "temperatureLapseRateCPerKm",
      unit: "degC/km",
      distribution,
    }],
    allCacheHit: true,
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
  startTime: result.startTime,
  endTime: result.endTime,
  diagnostic: result.selection.diagnostic,
  members: ["c00", "p01"] as const,
  quantiles: [0.5],
};

describe("handleGetGefsDiagnosticTimeSeries", () => {
  it("returns compact diagnostic series as structured MCP content", async () => {
    const response = await handleGetGefsDiagnosticTimeSeries({ getDiagnosticTimeSeries: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("turns failures into MCP tool errors", async () => {
    const response = await handleGetGefsDiagnosticTimeSeries({
      getDiagnosticTimeSeries: async () => { throw new Error("diagnostic series failed"); },
    }, query);
    expect(response).toEqual({ content: [{ type: "text", text: "diagnostic series failed" }], isError: true });
  });
});
