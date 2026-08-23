import { describe, expect, it } from "vitest";
import { handleGetGefsEnsembleProfile } from "../src/mcp-gefs-tool.js";
import type { GefsEnsembleProfileResult } from "../src/schema/gefs-ensemble-profile.js";

const result: GefsEnsembleProfileResult = {
  model: "gefs_0p50",
  run: "2026-08-23T12:00:00.000Z",
  validTime: "2026-08-23T18:00:00.000Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    variables: ["temperature", "geopotential_height"],
    pressureLevelsHpa: [850, 500],
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  summaries: [
    {
      variable: "temperature",
      gfsCode: "TMP",
      pressureLevelHpa: 850,
      outputField: "temperatureC",
      unit: "degC",
      memberCount: 2,
      mean: 8,
      populationStdDev: 1,
      min: 7,
      max: 9,
      quantiles: [{ quantile: 0.5, value: 8 }],
    },
    {
      variable: "geopotential_height",
      gfsCode: "HGT",
      pressureLevelHpa: 500,
      outputField: "geopotentialHeightGpm",
      unit: "gpm",
      memberCount: 2,
      mean: 5600,
      populationStdDev: 10,
      min: 5590,
      max: 5610,
      quantiles: [{ quantile: 0.5, value: 5600 }],
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
  validTime: result.validTime,
  variables: ["temperature", "geopotential_height"] as const,
  pressureLevelsHpa: [850, 500],
  members: ["c00", "p01"] as const,
  quantiles: [0.5],
};

describe("handleGetGefsEnsembleProfile", () => {
  it("returns profile summaries as structured MCP content", async () => {
    const response = await handleGetGefsEnsembleProfile({ getProfile: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("turns profile failures into MCP tool errors", async () => {
    const response = await handleGetGefsEnsembleProfile({
      getProfile: async () => { throw new Error("profile failed"); },
    }, query);
    expect(response).toEqual({ content: [{ type: "text", text: "profile failed" }], isError: true });
  });
});
