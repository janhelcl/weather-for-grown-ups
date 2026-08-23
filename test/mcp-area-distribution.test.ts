import { describe, expect, it } from "vitest";
import { handleGetGfsAreaSummary } from "../src/mcp-area-tool.js";
import type { AreaSummaryResult } from "../src/schema/area-summary-result.js";

const query = {
  westLongitude: 12,
  eastLongitude: 13,
  southLatitude: 48,
  northLatitude: 49,
  validTime: "2026-08-24T12:00:00Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850,
  percentiles: [50],
  thresholds: [{ operator: "gte" as const, value: 15 }],
  includeExtremaLocations: true,
};

const result: AreaSummaryResult = {
  model: "gfs_0p25",
  run: "2026-08-24T06:00:00.000Z",
  validTime: "2026-08-24T12:00:00.000Z",
  forecastHour: 6,
  bbox: { westLongitude: 12, eastLongitude: 13, southLatitude: 48, northLatitude: 49 },
  variable: { id: "temperature", pressureHpa: 850, field: "temperatureC", unit: "degC" },
  statistics: { definedGridPoints: 4, mean: 12.5, min: 0, max: 20, meanKind: "unweighted_grid_point_mean" },
  distribution: {
    percentileMethod: "linear_interpolation_sorted_defined_grid_points",
    percentiles: [{ percentile: 50, value: 15 }],
    thresholdFractions: [{ operator: "gte", threshold: 15, matchingGridPoints: 2, fraction: 0.5 }],
    extrema: {
      min: { value: 0, gridPoint: { latitude: 48, longitude: 12 }, tiedGridPoints: 1 },
      max: { value: 20, gridPoint: { latitude: 48, longitude: 12.5 }, tiedGridPoints: 2 },
    },
  },
  source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false },
};

describe("rich MCP area summary handler", () => {
  it("preserves the optional distribution in structured output", async () => {
    expect(await handleGetGfsAreaSummary({ summarize: async () => result }, query)).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("maps service failures to MCP errors", async () => {
    expect(await handleGetGfsAreaSummary({
      summarize: async () => { throw new Error("grid extraction failed"); },
    }, query)).toEqual({
      content: [{ type: "text", text: "grid extraction failed" }],
      isError: true,
    });
  });
});
