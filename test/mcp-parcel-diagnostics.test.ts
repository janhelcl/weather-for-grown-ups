import { describe, expect, it } from "vitest";
import type { ParcelDiagnosticsResult } from "../src/core/types.js";
import { deriveParcelComputation, type ParcelEnvironmentLevel } from "../src/derived/parcel-diagnostics.js";
import { handleGetGfsParcelDiagnostics } from "../src/mcp-tool.js";
import { parcelDiagnosticsResultSchema } from "../src/schema/result.js";

const surface: ParcelEnvironmentLevel = {
  pressureHpa: 1000,
  geopotentialHeightGpm: 100,
  temperatureC: 30,
  specificHumidityKgKg: 0.018,
};
const levels: ParcelEnvironmentLevel[] = [
  { pressureHpa: 950, geopotentialHeightGpm: 550, temperatureC: 27, specificHumidityKgKg: 0.015 },
  { pressureHpa: 900, geopotentialHeightGpm: 1000, temperatureC: 23, specificHumidityKgKg: 0.012 },
  { pressureHpa: 850, geopotentialHeightGpm: 1500, temperatureC: 14, specificHumidityKgKg: 0.009 },
  { pressureHpa: 800, geopotentialHeightGpm: 2000, temperatureC: 9, specificHumidityKgKg: 0.007 },
  { pressureHpa: 700, geopotentialHeightGpm: 3000, temperatureC: 0, specificHumidityKgKg: 0.004 },
  { pressureHpa: 600, geopotentialHeightGpm: 4200, temperatureC: -10, specificHumidityKgKg: 0.002 },
  { pressureHpa: 500, geopotentialHeightGpm: 5600, temperatureC: -22, specificHumidityKgKg: 0.001 },
  { pressureHpa: 400, geopotentialHeightGpm: 7200, temperatureC: -32, specificHumidityKgKg: 0.0006 },
  { pressureHpa: 300, geopotentialHeightGpm: 9200, temperatureC: -38, specificHumidityKgKg: 0.0003 },
  { pressureHpa: 250, geopotentialHeightGpm: 10400, temperatureC: -25, specificHumidityKgKg: 0.0002 },
];

const result: ParcelDiagnosticsResult = {
  model: "gfs_0p25",
  run: "2026-08-23T06:00:00.000Z",
  validTime: "2026-08-23T12:00:00.000Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  sampledPressureLevelsHpa: levels.map((level) => level.pressureHpa),
  levels: levels.map((level) => ({ ...level })),
  parcel: deriveParcelComputation("surface_2m", surface, levels),
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", cacheHit: false },
};

const query = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-23T06:00:00Z",
  validTime: "2026-08-23T12:00:00Z",
  pressureLevelsHpa: levels.map((level) => level.pressureHpa),
  parcel: "surface_2m" as const,
  source: "s3" as const,
};

describe("MCP parcel diagnostics", () => {
  it("accepts the parcel result through the shared contract", () => {
    expect(parcelDiagnosticsResultSchema.parse(result).parcel.startingState.definition).toBe("surface_2m");
  });

  it("returns matching text and structured content", async () => {
    const response = await handleGetGfsParcelDiagnostics({ getParcelDiagnostics: async () => result }, query);
    expect(response).not.toHaveProperty("isError");
    if (!("structuredContent" in response)) throw new Error("Expected MCP success response");
    expect(response.structuredContent.parcel.capeJkg).toBe(result.parcel.capeJkg);
    expect(response.content).toEqual([{ type: "text", text: JSON.stringify(response.structuredContent) }]);
  });

  it("rejects a future core result that violates the public schema", async () => {
    const invalid = { ...result, parcel: { ...result.parcel, capeJkg: -1 } } as ParcelDiagnosticsResult;
    const response = await handleGetGfsParcelDiagnostics({ getParcelDiagnostics: async () => invalid }, query);
    expect(response).toHaveProperty("isError", true);
  });
});
