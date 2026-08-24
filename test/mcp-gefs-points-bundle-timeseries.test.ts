import { describe, expect, it } from "vitest";
import { handleGetGefsFieldsPointsTimeSeries } from "../src/mcp-gefs-points-bundle-timeseries-tool.js";
import type { GefsPointsBundleTimeSeriesResult } from "../src/schema/gefs-points-bundle-timeseries.js";

const output: GefsPointsBundleTimeSeriesResult = {
  model: "gefs_0p50",
  run: "2026-08-24T00:00:00.000Z",
  startTime: "2026-08-24T03:00:00.000Z",
  endTime: "2026-08-24T03:00:00.000Z",
  stepHours: 3,
  selection: {
    variables: [],
    pressureLevelsHpa: [],
    fields: ["temperature_2m"],
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  includeMembers: false,
  series: [{
    validTime: "2026-08-24T03:00:00.000Z",
    forecastHour: 3,
    points: [{
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      pressureSummaries: [],
      fieldSummaries: [],
    }],
    allCacheHit: true,
  }],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    product: "pgrb2a_0p50",
    allCacheHit: true,
  },
};

describe("MCP GEFS multi-point bundle time series", () => {
  it("returns validated structured content", async () => {
    const response = await handleGetGefsFieldsPointsTimeSeries(
      { getPointsTimeSeries: async () => output },
      {
        points: [{ latitude: 50.08, longitude: 14.43 }],
        run: output.run,
        startTime: output.startTime,
        endTime: output.endTime,
        selection: { fields: ["temperature_2m"] },
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
    );

    expect(response).not.toHaveProperty("isError");
    expect(response.structuredContent).toEqual(output);
    expect(JSON.parse(response.content[0]!.text)).toEqual(output);
  });

  it("returns tool errors as MCP errors", async () => {
    const response = await handleGetGefsFieldsPointsTimeSeries(
      { getPointsTimeSeries: async () => { throw new Error("boom"); } },
      {
        points: [{ latitude: 50.08, longitude: 14.43 }],
        run: output.run,
        startTime: output.startTime,
        endTime: output.endTime,
        selection: { fields: ["temperature_2m"] },
        members: ["c00", "p01"],
      },
    );

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toBe("boom");
  });
});
