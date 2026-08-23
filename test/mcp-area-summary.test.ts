import { describe, expect, it } from "vitest";
import type { AreaSummaryResult } from "../src/core/types.js";
import { handleGetGfsAreaSummary } from "../src/mcp-tool.js";

const query = {
  westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
  validTime: "2026-08-19T12:00:00Z", variable: "temperature" as const, pressureLevelHpa: 850,
};
const result: AreaSummaryResult = {
  model: "gfs_0p25", run: "2026-08-19T06:00:00.000Z", validTime: "2026-08-19T12:00:00.000Z", forecastHour: 6,
  bbox: { westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51 },
  variable: { id: "temperature", pressureHpa: 850, field: "temperatureC", unit: "degC" },
  statistics: { definedGridPoints: 300, mean: 12, min: 2, max: 22, meanKind: "unweighted_grid_point_mean" },
  source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false },
};

const fieldQuery = {
  westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
  validTime: "2026-08-19T12:00:00Z", field: "low_cloud_cover_average" as const,
};
const fieldResult: AreaSummaryResult = {
  model: "gfs_0p25", run: "2026-08-19T06:00:00.000Z", validTime: "2026-08-19T12:00:00.000Z", forecastHour: 6,
  bbox: { westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51 },
  field: {
    id: "low_cloud_cover_average",
    level: { type: "named_layer", id: "low_cloud_layer" },
    temporal: {
      type: "average",
      startForecastHour: 3,
      endForecastHour: 6,
      startTime: "2026-08-19T09:00:00.000Z",
      endTime: "2026-08-19T12:00:00.000Z",
    },
    output: { field: "cloudCoverPct", unit: "%" },
  },
  statistics: { definedGridPoints: 300, mean: 55, min: 10, max: 100, meanKind: "unweighted_grid_point_mean" },
  source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: true },
};

describe("handleGetGfsAreaSummary", () => {
  it("returns pressure-level text and structured output", async () => {
    expect(await handleGetGfsAreaSummary({ summarize: async () => result }, query)).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result,
    });
  });

  it("returns non-isobaric field output with vertical and temporal semantics", async () => {
    const response = await handleGetGfsAreaSummary({ summarize: async () => fieldResult }, fieldQuery);
    expect(response).toHaveProperty("structuredContent");
    if (!("structuredContent" in response)) throw new Error("Expected structured content");
    expect(response.structuredContent).toEqual(fieldResult);
    expect(JSON.parse(response.content[0]!.text)).toEqual(fieldResult);
  });

  it("maps errors to MCP errors", async () => {
    expect(await handleGetGfsAreaSummary({ summarize: async () => { throw new Error("too large"); } }, query)).toEqual({
      content: [{ type: "text", text: "too large" }], isError: true,
    });
  });
});
