import { describe, expect, it } from "vitest";
import { handleGetGfsTransect } from "../src/mcp-transect-tool.js";
import type { TransectResult } from "../src/core/transect.js";

const result: TransectResult = {
  model: "gfs_0p25",
  run: "2026-08-24T06:00:00.000Z",
  validTime: "2026-08-24T12:00:00.000Z",
  forecastHour: 6,
  startPoint: { latitude: 50, longitude: 10 },
  endPoint: { latitude: 50, longitude: 20 },
  totalDistanceKm: 714.2,
  variables: ["temperature", "wind"],
  pressureLevelsHpa: [850, 700],
  samples: [
    {
      index: 0,
      fraction: 0,
      distanceKm: 0,
      requestedPoint: { latitude: 50, longitude: 10 },
      gridPoint: { latitude: 50, longitude: 10 },
      levels: [{ pressureHpa: 850, temperatureC: 10, windSpeedMs: 5 }],
    },
    {
      index: 1,
      fraction: 1,
      distanceKm: 714.2,
      requestedPoint: { latitude: 50, longitude: 20 },
      gridPoint: { latitude: 50, longitude: 20 },
      levels: [{ pressureHpa: 850, temperatureC: 11, windSpeedMs: 6 }],
    },
  ],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    cacheHit: true,
  },
};

const query = {
  start: { latitude: 50, longitude: 10 },
  end: { latitude: 50, longitude: 20 },
  validTime: "2026-08-24T12:00:00Z",
  variables: ["temperature", "wind"] as const,
  pressureLevelsHpa: [850, 700],
  samples: 2,
};

describe("handleGetGfsTransect", () => {
  it("returns text and structured output", async () => {
    expect(await handleGetGfsTransect({ getTransect: async () => result }, query)).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("maps service failures to MCP errors", async () => {
    expect(await handleGetGfsTransect({
      getTransect: async () => { throw new Error("transect unavailable"); },
    }, query)).toEqual({
      content: [{ type: "text", text: "transect unavailable" }],
      isError: true,
    });
  });
});
