import { describe, expect, it } from "vitest";
import { handleGetGfsPointsTimeSeries } from "../src/mcp-tool.js";
import type { PointsTimeSeriesResult } from "../src/core/types.js";

const query = {
  points: [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 45.80, longitude: 11.70 },
  ],
  startTime: "2026-08-19T06:00:00Z",
  endTime: "2026-08-19T09:00:00Z",
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
};

const result: PointsTimeSeriesResult = {
  model: "gfs_0p25",
  run: "2026-08-19T06:00:00.000Z",
  requestedStartTime: "2026-08-19T06:00:00.000Z",
  requestedEndTime: "2026-08-19T09:00:00.000Z",
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2" },
  series: [{
    validTime: "2026-08-19T06:00:00.000Z",
    forecastHour: 0,
    cacheHit: false,
    points: [
      {
        requestedPoint: { latitude: 50.08, longitude: 14.43 },
        gridPoint: { latitude: 50, longitude: 14.5 },
        levels: [{ pressureHpa: 850, temperatureC: 12 }],
      },
      {
        requestedPoint: { latitude: 45.80, longitude: 11.70 },
        gridPoint: { latitude: 45.75, longitude: 11.75 },
        levels: [{ pressureHpa: 850, temperatureC: 15 }],
      },
    ],
  }],
};

describe("handleGetGfsPointsTimeSeries", () => {
  it("returns equivalent text and structured MCP output", async () => {
    const response = await handleGetGfsPointsTimeSeries(
      { getPointsTimeSeries: async () => result },
      query,
    );
    expect(response).not.toHaveProperty("isError");
    expect(response.structuredContent).toEqual(result);
    expect(response.content).toHaveLength(1);
    expect(response.content[0]?.type).toBe("text");
    expect(JSON.parse(response.content[0]!.text)).toEqual(result);
  });

  it("maps matrix guard failures to MCP errors", async () => {
    const response = await handleGetGfsPointsTimeSeries({
      getPointsTimeSeries: async () => { throw new Error("too many point-steps"); },
    }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: "too many point-steps" }],
      isError: true,
    });
  });
});
