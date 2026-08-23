import { describe, expect, it } from "vitest";
import { getGfsPressureCatalog } from "../src/catalog/catalog.js";
import type { ProfileDiagnosticsResult } from "../src/core/types.js";
import { handleGetGfsProfileDiagnostics } from "../src/mcp-tool.js";
import { profileDiagnosticsResultSchema } from "../src/schema/result.js";

const result: ProfileDiagnosticsResult = {
  model: "gfs_0p25",
  run: "2026-08-20T06:00:00.000Z",
  validTime: "2026-08-20T12:00:00.000Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  sampledPressureLevelsHpa: [900, 800, 700],
  levels: [
    { pressureHpa: 900, temperatureC: 5, geopotentialHeightGpm: 1000 },
    { pressureHpa: 800, temperatureC: -5, geopotentialHeightGpm: 2000 },
    { pressureHpa: 700, temperatureC: -3, geopotentialHeightGpm: 3000 },
  ],
  diagnostics: [
    {
      id: "freezing_level_crossings",
      crossings: [{
        pressureHpa: Math.sqrt(900 * 800),
        geopotentialHeightGpm: 1500,
        method: "interpolated",
        transition: "warm_to_cold",
        lowerLevel: { pressureHpa: 900, temperatureC: 5, geopotentialHeightGpm: 1000 },
        upperLevel: { pressureHpa: 800, temperatureC: -5, geopotentialHeightGpm: 2000 },
      }],
    },
    {
      id: "temperature_inversion_layers",
      layers: [{
        basePressureHpa: 800,
        topPressureHpa: 700,
        baseGeopotentialHeightGpm: 2000,
        topGeopotentialHeightGpm: 3000,
        baseTemperatureC: -5,
        topTemperatureC: -3,
        depthGpm: 1000,
        temperatureIncreaseC: 2,
        meanTemperatureGradientCPerKm: 2,
        sampledSegments: 1,
      }],
    },
  ],
  source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false },
};

const query = {
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  validTime: result.validTime,
  pressureLevelsHpa: [900, 800, 700],
  diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"] as const,
};

describe("whole-profile diagnostics shared surfaces", () => {
  it("advertises both profile diagnostics in the agent-facing catalog", () => {
    const catalog = getGfsPressureCatalog();
    expect(catalog.profileDiagnostics.map((diagnostic) => diagnostic.id)).toEqual([
      "freezing_level_crossings",
      "temperature_inversion_layers",
    ]);
    expect(catalog.profileDiagnosticsNote).toMatch(/explicitly requested pressure levels/);
  });

  it("accepts the whole-profile shared result contract", () => {
    expect(profileDiagnosticsResultSchema.parse(result)).toEqual(result);
  });

  it("returns whole-profile diagnostics through the MCP boundary", async () => {
    const response = await handleGetGfsProfileDiagnostics({ getProfileDiagnostics: async () => result }, query);
    expect(response).not.toHaveProperty("isError");
    if (!("structuredContent" in response)) throw new Error("Expected MCP success response");
    expect(response.structuredContent).toEqual(result);
    expect(response.content).toEqual([{ type: "text", text: JSON.stringify(response.structuredContent) }]);
  });

  it("rejects malformed future core output at the MCP boundary", async () => {
    const invalid = {
      ...result,
      diagnostics: [{ id: "temperature_inversion_layers", layers: [{
        ...result.diagnostics[1] && result.diagnostics[1].id === "temperature_inversion_layers" ? result.diagnostics[1].layers[0] : {},
        depthGpm: -1,
      }] }],
    } as unknown as ProfileDiagnosticsResult;
    const response = await handleGetGfsProfileDiagnostics({ getProfileDiagnostics: async () => invalid }, query);
    expect(response).toMatchObject({ isError: true });
  });
});
