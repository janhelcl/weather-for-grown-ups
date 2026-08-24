import { describe, expect, it } from "vitest";
import { handleGetGefsFieldsPoints } from "../src/mcp-gefs-points-bundle-tool.js";
import type { GefsPointsBundleResult } from "../src/schema/gefs-points-bundle.js";

const result: GefsPointsBundleResult = {
  model: "gefs_0p50",
  run: "2026-08-24T00:00:00Z",
  validTime: "2026-08-24T03:00:00Z",
  forecastHour: 3,
  selection: {
    variables: [],
    pressureLevelsHpa: [],
    fields: ["temperature_2m"],
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  includeMembers: false,
  points: [{
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    pressureSummaries: [],
    fieldSummaries: [{
      field: "temperature_2m",
      level: { gribLevel: "2 m above ground", description: "2 m above ground" },
      temporal: { type: "instantaneous" },
      outputs: [{
        aggregation: "numeric_distribution",
        field: "temperatureC",
        unit: "degC",
        distribution: {
          memberCount: 2,
          mean: 15,
          populationStdDev: 1,
          min: 14,
          max: 16,
          quantiles: [{ quantile: 0.5, value: 15 }],
        },
      }],
    }],
  }],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    product: "pgrb2a_0p50",
    memberFiles: [
      { member: "c00", cacheHit: true },
      { member: "p01", cacheHit: true },
    ],
    allCacheHit: true,
  },
};

describe("GEFS multi-point mixed bundle MCP handler", () => {
  it("returns structured multi-point ensemble content", async () => {
    const response = await handleGetGefsFieldsPoints(
      { getPoints: async () => result },
      {
        points: [{ latitude: 50.08, longitude: 14.43 }],
        run: result.run,
        validTime: result.validTime,
        selection: { fields: ["temperature_2m"] },
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
    );
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("turns multi-point failures into MCP tool errors", async () => {
    const response = await handleGetGefsFieldsPoints(
      { getPoints: async () => { throw new Error("points failed"); } },
      {
        points: [{ latitude: 50.08, longitude: 14.43 }],
        run: result.run,
        validTime: result.validTime,
        selection: { fields: ["temperature_2m"] },
        members: ["c00", "p01"],
      },
    );
    expect(response).toEqual({
      content: [{ type: "text", text: "points failed" }],
      isError: true,
    });
  });
});
