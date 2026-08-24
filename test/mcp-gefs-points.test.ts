import { describe, expect, it } from "vitest";
import { handleGetGefsPoints } from "../src/mcp-gefs-tool.js";

const query = {
  points: [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 46.24, longitude: 13.18 },
  ],
  run: "2026-08-24T00:00:00.000Z",
  validTime: "2026-08-24T06:00:00.000Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850,
  members: ["c00", "p01", "p02"] as const,
  quantiles: [0.1, 0.5, 0.9],
};

const distribution = {
  memberCount: 3,
  mean: 5,
  populationStdDev: 1,
  min: 4,
  max: 6,
  quantiles: [
    { quantile: 0.1, value: 4.2 },
    { quantile: 0.5, value: 5 },
    { quantile: 0.9, value: 5.8 },
  ],
};

const result = {
  model: "gefs_0p50" as const,
  run: query.run,
  validTime: query.validTime,
  forecastHour: 6,
  selection: {
    variable: "temperature" as const,
    gfsCode: "TMP",
    pressureLevelHpa: 850,
    outputField: "temperatureC",
    unit: "degC",
    members: ["c00", "p01", "p02"] as const,
    quantiles: [0.1, 0.5, 0.9],
  },
  points: [
    {
      requestedPoint: query.points[0]!,
      gridPoint: { latitude: 50, longitude: 14.5 },
      summary: distribution,
    },
    {
      requestedPoint: query.points[1]!,
      gridPoint: { latitude: 46, longitude: 13 },
      summary: { ...distribution, mean: 7, min: 6, max: 8 },
    },
  ],
  source: {
    provider: "NOAA AWS Open Data" as const,
    access: "s3_range" as const,
    decoder: "wgrib2" as const,
    product: "pgrb2a_0p50" as const,
    memberFiles: [
      { member: "c00" as const, cacheHit: false },
      { member: "p01" as const, cacheHit: false },
      { member: "p02" as const, cacheHit: true },
    ],
    allCacheHit: false,
  },
};

describe("GEFS multi-point MCP handler", () => {
  it("returns validated structured content", async () => {
    const response = await handleGetGefsPoints({ getPoints: async () => result }, query);
    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(response.content[0]?.type).toBe("text");
  });

  it("returns an MCP error when the service fails", async () => {
    const response = await handleGetGefsPoints({
      getPoints: async () => { throw new Error("member unavailable"); },
    }, query);
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("member unavailable");
  });
});
