import { describe, expect, it } from "vitest";
import { handleGetGefsPointsTimeSeries } from "../src/mcp-gefs-points-timeseries-tool.js";

const query = {
  points: [{ latitude: 50.08, longitude: 14.43 }],
  run: "2026-08-24T00:00:00Z",
  startTime: "2026-08-24T03:00:00Z",
  endTime: "2026-08-24T03:00:00Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850,
  members: ["c00", "p01"] as ("c00" | "p01")[],
  quantiles: [0.5],
};

const result = {
  model: "gefs_0p50" as const,
  run: "2026-08-24T00:00:00.000Z",
  startTime: "2026-08-24T03:00:00.000Z",
  endTime: "2026-08-24T03:00:00.000Z",
  stepHours: 3 as const,
  selection: {
    variable: "temperature" as const,
    gfsCode: "TMP",
    pressureLevelHpa: 850,
    outputField: "temperatureC",
    unit: "degC",
    members: ["c00", "p01"] as ("c00" | "p01")[],
    quantiles: [0.5],
  },
  includeMembers: false,
  series: [{
    validTime: "2026-08-24T03:00:00.000Z",
    forecastHour: 3,
    points: [{
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      summary: {
        memberCount: 2,
        mean: 10,
        populationStdDev: 1,
        min: 9,
        max: 11,
        quantiles: [{ quantile: 0.5, value: 10 }],
      },
    }],
    allCacheHit: true,
  }],
  source: {
    provider: "NOAA AWS Open Data" as const,
    access: "s3_range" as const,
    decoder: "wgrib2" as const,
    product: "pgrb2a_0p50" as const,
    allCacheHit: true,
  },
};

describe("GEFS points time-series MCP handler", () => {
  it("returns validated structured content", async () => {
    const response = await handleGetGefsPointsTimeSeries({
      getPointsTimeSeries: async (received) => {
        expect(received).toEqual(query);
        return result;
      },
    }, query);

    expect(response).not.toHaveProperty("isError");
    expect(response.structuredContent).toEqual(result);
    expect(JSON.parse(response.content[0]!.text)).toEqual(result);
  });

  it("converts service failures into MCP errors", async () => {
    const response = await handleGetGefsPointsTimeSeries({
      getPointsTimeSeries: async () => { throw new Error("boom"); },
    }, query);

    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toBe("boom");
  });
});
