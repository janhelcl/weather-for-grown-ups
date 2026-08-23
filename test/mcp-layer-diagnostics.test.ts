import { describe, expect, it } from "vitest";
import type { LayerDiagnosticsResult } from "../src/core/types.js";
import { handleGetGfsLayerDiagnostics } from "../src/mcp-tool.js";
import { layerDiagnosticsResultSchema } from "../src/schema/result.js";

const result: LayerDiagnosticsResult = {
  model: "gfs_0p25",
  run: "2026-08-20T06:00:00.000Z",
  validTime: "2026-08-20T12:00:00.000Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  layer: {
    lowerPressureHpa: 850,
    upperPressureHpa: 700,
    lowerGeopotentialHeightGpm: 1500,
    upperGeopotentialHeightGpm: 3000,
    depthGpm: 1500,
  },
  levels: [
    { pressureHpa: 850, temperatureC: 12, geopotentialHeightGpm: 1500, uWindMs: 3, vWindMs: 4 },
    { pressureHpa: 700, temperatureC: 0, geopotentialHeightGpm: 3000, uWindMs: -10, vWindMs: 0 },
  ],
  diagnostics: [
    { id: "temperature_lapse_rate", values: { temperatureLapseRateCPerKm: 8 } },
    { id: "wind_shear", values: { uWindShearMs: -13, vWindShearMs: -4, windShearMagnitudeMs: 13.60147, windShearMsPerKm: 9.067647 } },
  ],
  source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false },
};

const query = {
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  validTime: result.validTime,
  lowerPressureHpa: 850,
  upperPressureHpa: 700,
  diagnostics: ["temperature_lapse_rate", "wind_shear"] as const,
};

describe("MCP pressure-layer diagnostics", () => {
  it("uses the shared result contract", () => {
    expect(layerDiagnosticsResultSchema.parse(result)).toEqual(result);
  });

  it("returns layer diagnostics as structured content", async () => {
    const response = await handleGetGfsLayerDiagnostics({ getLayerDiagnostics: async () => result }, query);
    expect(response).not.toHaveProperty("isError");
    if (!("structuredContent" in response)) throw new Error("Expected MCP success response");
    expect(response.structuredContent).toEqual(result);
    expect(response.content).toEqual([{ type: "text", text: JSON.stringify(result) }]);
  });

  it("rejects a future invalid core result at the MCP boundary", async () => {
    const response = await handleGetGfsLayerDiagnostics(
      { getLayerDiagnostics: async () => ({ ...result, layer: { ...result.layer, depthGpm: -1 } } as LayerDiagnosticsResult) },
      query,
    );
    expect(response).toMatchObject({ isError: true });
  });
});
