import { describe, expect, it } from "vitest";
import { handleCompareGefsRuns } from "../src/mcp-gefs-tool.js";

const query = {
  latitude: 50.08,
  longitude: 14.43,
  anchorRun: "2026-08-23T12:00:00.000Z",
  validTime: "2026-08-23T18:00:00.000Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850,
  members: ["c00", "p01", "p02"] as const,
  quantiles: [0.1, 0.5, 0.9],
  cycles: 2,
};

const result = {
  model: "gefs_0p50" as const,
  validTime: query.validTime,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  anchorRun: query.anchorRun,
  selection: {
    variable: "temperature" as const,
    gfsCode: "TMP",
    pressureLevelHpa: 850,
    outputField: "temperatureC",
    unit: "degC",
    members: ["c00", "p01", "p02"] as const,
    quantiles: [0.1, 0.5, 0.9],
  },
  runs: [
    {
      run: "2026-08-23T06:00:00.000Z",
      forecastHour: 12,
      summary: {
        memberCount: 3,
        mean: 6,
        populationStdDev: 1.5,
        min: 4,
        max: 8,
        quantiles: [
          { quantile: 0.1, value: 4.5 },
          { quantile: 0.5, value: 6 },
          { quantile: 0.9, value: 7.5 },
        ],
      },
      allCacheHit: false,
    },
    {
      run: "2026-08-23T12:00:00.000Z",
      forecastHour: 6,
      summary: {
        memberCount: 3,
        mean: 7,
        populationStdDev: 1,
        min: 5,
        max: 9,
        quantiles: [
          { quantile: 0.1, value: 5.5 },
          { quantile: 0.5, value: 7 },
          { quantile: 0.9, value: 8.5 },
        ],
      },
      allCacheHit: true,
    },
  ],
  comparisons: [
    {
      fromRun: "2026-08-23T06:00:00.000Z",
      toRun: "2026-08-23T12:00:00.000Z",
      fromForecastHour: 12,
      toForecastHour: 6,
      mean: { from: 6, to: 7, delta: 1 },
      populationStdDev: { from: 1.5, to: 1, delta: -0.5 },
      min: { from: 4, to: 5, delta: 1 },
      max: { from: 8, to: 9, delta: 1 },
      quantiles: [
        { quantile: 0.1, from: 4.5, to: 5.5, delta: 1 },
        { quantile: 0.5, from: 6, to: 7, delta: 1 },
        { quantile: 0.9, from: 7.5, to: 8.5, delta: 1 },
      ],
      interpretation: "distribution_shift_between_model_cycles_not_member_trajectory" as const,
    },
  ],
  source: {
    provider: "NOAA AWS Open Data" as const,
    access: "s3_range" as const,
    decoder: "wgrib2" as const,
    product: "pgrb2a_0p50" as const,
  },
};

describe("GEFS run comparison MCP handler", () => {
  it("returns validated structured content", async () => {
    const response = await handleCompareGefsRuns({ compareRuns: async () => result }, query);
    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(response.content[0]?.type).toBe("text");
  });

  it("returns an MCP error when the service fails", async () => {
    const response = await handleCompareGefsRuns({
      compareRuns: async () => { throw new Error("upstream missing"); },
    }, query);
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("upstream missing");
  });
});
