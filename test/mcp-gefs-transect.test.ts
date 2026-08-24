import { describe, expect, it } from "vitest";
import { handleGetGefsTransect } from "../src/mcp-gefs-transect-tool.js";
import type { GefsTransectResult } from "../src/schema/gefs-transect.js";

const output: GefsTransectResult = {
  model: "gefs_0p50",
  run: "2026-08-24T00:00:00.000Z",
  validTime: "2026-08-24T12:00:00.000Z",
  forecastHour: 12,
  startPoint: { latitude: 50, longitude: 14 },
  endPoint: { latitude: 49, longitude: 16 },
  totalDistanceKm: 180,
  selection: {
    variables: [],
    pressureLevelsHpa: [],
    fields: ["temperature_2m"],
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  includeMembers: false,
  samples: [
    {
      index: 0,
      fraction: 0,
      distanceKm: 0,
      requestedPoint: { latitude: 50, longitude: 14 },
      gridPoint: { latitude: 50, longitude: 14 },
      pressureSummaries: [],
      fieldSummaries: [],
    },
    {
      index: 1,
      fraction: 1,
      distanceKm: 180,
      requestedPoint: { latitude: 49, longitude: 16 },
      gridPoint: { latitude: 49, longitude: 16 },
      pressureSummaries: [],
      fieldSummaries: [],
    },
  ],
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

describe("MCP GEFS transect", () => {
  it("returns validated structured content", async () => {
    const response = await handleGetGefsTransect(
      { getTransect: async () => output },
      {
        start: output.startPoint,
        end: output.endPoint,
        run: output.run,
        validTime: output.validTime,
        selection: { fields: ["temperature_2m"] },
        members: ["c00", "p01"],
        quantiles: [0.5],
        samples: 2,
      },
    );
    expect(response).not.toHaveProperty("isError");
    expect(response.structuredContent).toEqual(output);
    expect(JSON.parse(response.content[0]!.text)).toEqual(output);
  });

  it("returns service failures as MCP errors", async () => {
    const response = await handleGetGefsTransect(
      { getTransect: async () => { throw new Error("boom"); } },
      {
        start: output.startPoint,
        end: output.endPoint,
        run: output.run,
        validTime: output.validTime,
        selection: { fields: ["temperature_2m"] },
        members: ["c00", "p01"],
        samples: 2,
      },
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toBe("boom");
  });
});
