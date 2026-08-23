import { describe, expect, it } from "vitest";
import { handleGetGfsDiagnosticTimeSeries } from "../src/mcp-tool.js";
import type { DiagnosticTimeSeriesResult } from "../src/schema/diagnostic-time-series-result.js";

const query = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-23T06:00:00Z",
  startTime: "2026-08-23T12:00:00Z",
  endTime: "2026-08-23T13:00:00Z",
  diagnostic: {
    kind: "layer" as const,
    lowerPressureHpa: 850,
    upperPressureHpa: 700,
    diagnostics: ["temperature_lapse_rate" as const],
  },
};

const result: DiagnosticTimeSeriesResult = {
  model: "gfs_0p25",
  run: "2026-08-23T06:00:00.000Z",
  requestedStartTime: "2026-08-23T12:00:00.000Z",
  requestedEndTime: "2026-08-23T13:00:00.000Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2" },
  diagnostic: {
    kind: "layer",
    lowerPressureHpa: 850,
    upperPressureHpa: 700,
    diagnostics: ["temperature_lapse_rate"],
  },
  series: [{
    kind: "layer",
    validTime: "2026-08-23T12:00:00.000Z",
    forecastHour: 6,
    layer: {
      lowerPressureHpa: 850,
      upperPressureHpa: 700,
      lowerGeopotentialHeightGpm: 1500,
      upperGeopotentialHeightGpm: 3000,
      depthGpm: 1500,
    },
    diagnostics: [{ id: "temperature_lapse_rate", values: { temperatureLapseRateCPerKm: 6.5 } }],
    cacheHit: false,
  }],
};

describe("handleGetGfsDiagnosticTimeSeries", () => {
  it("returns matching text and structured content", async () => {
    const response = await handleGetGfsDiagnosticTimeSeries({
      getDiagnosticTimeSeries: async () => result,
    }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("rejects a core result that violates the public family contract", async () => {
    const invalid = {
      ...result,
      diagnostic: {
        kind: "profile" as const,
        pressureLevelsHpa: [850, 700],
        diagnostics: ["freezing_level_crossings" as const],
      },
    } as DiagnosticTimeSeriesResult;
    const response = await handleGetGfsDiagnosticTimeSeries({
      getDiagnosticTimeSeries: async () => invalid,
    }, query);
    expect(response).toHaveProperty("isError", true);
  });

  it("maps service failures to MCP errors", async () => {
    const response = await handleGetGfsDiagnosticTimeSeries({
      getDiagnosticTimeSeries: async () => { throw new Error("too many steps"); },
    }, query);
    expect(response).toEqual({ content: [{ type: "text", text: "too many steps" }], isError: true });
  });
});
