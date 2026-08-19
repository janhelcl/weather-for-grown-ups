import { describe, expect, it } from "vitest";
import { handleGetGfsAreaSummary } from "../src/mcp-tool.js";
import type { AreaSummaryResult } from "../src/core/types.js";

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

describe("handleGetGfsAreaSummary", () => {
  it("returns text and structured output", async () => {
    expect(await handleGetGfsAreaSummary({ summarize: async () => result }, query)).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result,
    });
  });

  it("maps errors to MCP errors", async () => {
    expect(await handleGetGfsAreaSummary({ summarize: async () => { throw new Error("too large"); } }, query)).toEqual({
      content: [{ type: "text", text: "too large" }], isError: true,
    });
  });
});
