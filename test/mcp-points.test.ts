import { describe, expect, it } from "vitest";
import { handleGetGfsPoints } from "../src/mcp-tool.js";
import type { BatchPointsResult } from "../src/core/types.js";

const result: BatchPointsResult = {
  model: "gfs_0p25",
  run: "2026-08-19T06:00:00.000Z",
  validTime: "2026-08-19T12:00:00.000Z",
  forecastHour: 6,
  points: [
    {
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      levels: [{ pressureHpa: 850, temperatureC: 12 }],
    },
    {
      requestedPoint: { latitude: 45.8, longitude: 11.7 },
      gridPoint: { latitude: 45.75, longitude: 11.75 },
      levels: [{ pressureHpa: 850, temperatureC: 14 }],
    },
  ],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    cacheHit: false,
  },
};

const query = {
  points: result.points.map((point) => point.requestedPoint),
  run: result.run,
  validTime: result.validTime,
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
};

describe("handleGetGfsPoints", () => {
  it("returns the shared batched result contract as structured content", async () => {
    const response = await handleGetGfsPoints({ getPoints: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("turns batch service failures into MCP tool errors", async () => {
    const response = await handleGetGfsPoints({
      getPoints: async () => { throw new Error("batch failed"); },
    }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: "batch failed" }],
      isError: true,
    });
  });
});
