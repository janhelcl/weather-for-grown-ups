import { describe, expect, it } from "vitest";
import { handleGetGfsTimeSeries } from "../src/mcp-tool.js";
import type { TimeSeriesResult } from "../src/core/types.js";

const query = {
  latitude: 50.08,
  longitude: 14.43,
  startTime: "2026-08-19T06:00:00Z",
  endTime: "2026-08-19T09:00:00Z",
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
};

const result: TimeSeriesResult = {
  model: "gfs_0p25",
  run: "2026-08-19T06:00:00.000Z",
  requestedStartTime: "2026-08-19T06:00:00.000Z",
  requestedEndTime: "2026-08-19T09:00:00.000Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2" },
  series: [{ validTime: "2026-08-19T06:00:00.000Z", forecastHour: 0, levels: [{ pressureHpa: 850, temperatureC: 12 }], cacheHit: false }],
};

describe("handleGetGfsTimeSeries", () => {
  it("returns text and structured MCP output", async () => {
    const response = await handleGetGfsTimeSeries({ getTimeSeries: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("maps Error failures to MCP errors", async () => {
    const response = await handleGetGfsTimeSeries({
      getTimeSeries: async () => { throw new Error("too many steps"); },
    }, query);
    expect(response).toEqual({ content: [{ type: "text", text: "too many steps" }], isError: true });
  });

  it("stringifies non-Error failures", async () => {
    const response = await handleGetGfsTimeSeries({
      getTimeSeries: async () => { throw "bad series"; },
    }, query);
    expect(response).toEqual({ content: [{ type: "text", text: "bad series" }], isError: true });
  });
});
