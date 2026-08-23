import { describe, expect, it } from "vitest";
import type { RunComparisonResult } from "../src/core/run-comparison.js";
import { handleCompareGfsRuns } from "../src/mcp-tool.js";

const query = {
  latitude: 50.08,
  longitude: 14.43,
  anchorRun: "2026-08-19T12:00:00Z",
  validTime: "2026-08-20T12:00:00Z",
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
  cycles: 2,
};

const result: RunComparisonResult = {
  model: "gfs_0p25",
  validTime: "2026-08-20T12:00:00.000Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  anchorRun: "2026-08-19T12:00:00.000Z",
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2" },
  runs: [
    {
      run: "2026-08-19T06:00:00.000Z",
      forecastHour: 30,
      levels: [{ pressureHpa: 850, temperatureC: 9 }],
      cacheHit: false,
    },
    {
      run: "2026-08-19T12:00:00.000Z",
      forecastHour: 24,
      levels: [{ pressureHpa: 850, temperatureC: 10 }],
      cacheHit: true,
    },
  ],
  comparisons: [{
    fromRun: "2026-08-19T06:00:00.000Z",
    toRun: "2026-08-19T12:00:00.000Z",
    fromForecastHour: 30,
    toForecastHour: 24,
    pressureLevels: [{
      pressureHpa: 850,
      changes: [{ field: "temperatureC", from: 9, to: 10, delta: 1, deltaKind: "linear" }],
    }],
    fields: [],
  }],
};

describe("handleCompareGfsRuns", () => {
  it("returns schema-normalized text and structured MCP output", async () => {
    const response = await handleCompareGfsRuns({ compareRuns: async () => result }, query);
    expect(response).toHaveProperty("structuredContent");
    if (!("structuredContent" in response)) throw new Error("Expected structured content");
    expect(response.structuredContent).toEqual(result);
    expect(response.content).toHaveLength(1);
    expect(JSON.parse(response.content[0]!.text)).toEqual(result);
  });

  it("maps comparison failures to MCP errors", async () => {
    const response = await handleCompareGfsRuns({
      compareRuns: async () => { throw new Error("older cycle unavailable"); },
    }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: "older cycle unavailable" }],
      isError: true,
    });
  });
});
