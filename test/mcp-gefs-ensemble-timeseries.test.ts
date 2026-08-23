import { describe, expect, it } from "vitest";
import { handleGetGefsEnsembleTimeSeries } from "../src/mcp-gefs-tool.js";
import type { GefsEnsembleTimeSeriesResult } from "../src/schema/gefs-ensemble-timeseries.js";

const result: GefsEnsembleTimeSeriesResult = {
  model: "gefs_0p50",
  run: "2026-08-23T12:00:00.000Z",
  startTime: "2026-08-23T15:00:00.000Z",
  endTime: "2026-08-23T18:00:00.000Z",
  stepHours: 3,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    variable: "temperature",
    gfsCode: "TMP",
    pressureLevelHpa: 850,
    outputField: "temperatureC",
    unit: "degC",
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  includeMembers: false,
  series: [
    {
      validTime: "2026-08-23T15:00:00.000Z",
      forecastHour: 3,
      summary: {
        memberCount: 2,
        mean: 10,
        populationStdDev: 1,
        min: 9,
        max: 11,
        quantiles: [{ quantile: 0.5, value: 10 }],
      },
    },
    {
      validTime: "2026-08-23T18:00:00.000Z",
      forecastHour: 6,
      summary: {
        memberCount: 2,
        mean: 11,
        populationStdDev: 1,
        min: 10,
        max: 12,
        quantiles: [{ quantile: 0.5, value: 11 }],
      },
    },
  ],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    product: "pgrb2a_0p50",
    allCacheHit: true,
  },
};

const query = {
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  startTime: result.startTime,
  endTime: result.endTime,
  variable: "temperature" as const,
  pressureLevelHpa: 850,
  members: ["c00", "p01"] as const,
  quantiles: [0.5],
};

describe("handleGetGefsEnsembleTimeSeries", () => {
  it("returns structured MCP output", async () => {
    const response = await handleGetGefsEnsembleTimeSeries({ getTimeSeries: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("converts failures into MCP tool errors", async () => {
    const response = await handleGetGefsEnsembleTimeSeries({
      getTimeSeries: async () => { throw new Error("timeseries failed"); },
    }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: "timeseries failed" }],
      isError: true,
    });
  });
});
