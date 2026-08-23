import { describe, expect, it } from "vitest";
import type { ProfileResult } from "../src/core/types.js";
import { handleGetGfsProfile } from "../src/mcp-tool.js";
import {
  latestGfsRunResultSchema,
  profileResultSchema,
  timeSeriesResultSchema,
} from "../src/schema/result.js";

const namedLayerAverageField = {
  id: "low_cloud_cover_average" as const,
  level: { type: "named_layer" as const, id: "low_cloud_layer" as const },
  temporal: {
    type: "average" as const,
    startForecastHour: 0,
    endForecastHour: 3,
    startTime: "2026-08-20T06:00:00.000Z",
    endTime: "2026-08-20T09:00:00.000Z",
  },
  values: { cloudCoverPct: 55 },
};

const namedLevelAverageField = {
  id: "low_cloud_base_pressure" as const,
  level: { type: "named_level" as const, id: "low_cloud_base" as const },
  temporal: {
    type: "average" as const,
    startForecastHour: 0,
    endForecastHour: 3,
    startTime: "2026-08-20T06:00:00.000Z",
    endTime: "2026-08-20T09:00:00.000Z",
  },
  values: { pressurePa: 81200 },
};

const profile: ProfileResult = {
  model: "gfs_0p25",
  run: "2026-08-20T06:00:00.000Z",
  validTime: "2026-08-20T09:00:00.000Z",
  forecastHour: 3,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  levels: [],
  fields: [namedLayerAverageField, namedLevelAverageField],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    cacheHit: false,
  },
};

describe("shared surface result contracts", () => {
  it("accepts named layers, named levels, and forecast-window averages", () => {
    expect(profileResultSchema.parse(profile)).toEqual(profile);
  });

  it("uses the same field contract inside time series", () => {
    const result = timeSeriesResultSchema.parse({
      model: "gfs_0p25",
      run: profile.run,
      requestedStartTime: profile.validTime,
      requestedEndTime: profile.validTime,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: "wgrib2",
      },
      series: [{
        validTime: profile.validTime,
        forecastHour: 3,
        levels: [],
        fields: profile.fields,
        cacheHit: false,
      }],
    });

    expect(result.series[0]?.fields).toEqual(profile.fields);
  });

  it("rejects incomplete interval semantics", () => {
    expect(() => profileResultSchema.parse({
      ...profile,
      fields: [{
        ...namedLayerAverageField,
        temporal: { type: "average", startForecastHour: 0, endForecastHour: 3 },
      }],
    })).toThrow();
  });

  it("keeps latest-run JSON provenance explicit for both surfaces", () => {
    expect(latestGfsRunResultSchema.parse({
      model: "gfs_0p25",
      run: "2026-08-20T06:00:00.000Z",
      completeness: "f384",
      discoverySource: "NOAA AWS Open Data",
    })).toEqual({
      model: "gfs_0p25",
      run: "2026-08-20T06:00:00.000Z",
      completeness: "f384",
      discoverySource: "NOAA AWS Open Data",
    });
  });
});

describe("MCP result boundary", () => {
  it("returns layer-valued and averaged profile fields as structured content", async () => {
    const response = await handleGetGfsProfile(
      { getProfile: async () => profile },
      {
        latitude: 50.08,
        longitude: 14.43,
        run: profile.run,
        validTime: profile.validTime,
        fields: ["low_cloud_cover_average", "low_cloud_base_pressure"],
      },
    );

    expect(response).not.toHaveProperty("isError");
    expect(response.structuredContent).toMatchObject({ fields: profile.fields });
  });

  it("fails loudly if a future core result violates the shared contract", async () => {
    const response = await handleGetGfsProfile(
      { getProfile: async () => ({
        ...profile,
        fields: [{
          ...namedLayerAverageField,
          temporal: { type: "average" },
        }],
      } as unknown as ProfileResult) },
      {
        latitude: 50.08,
        longitude: 14.43,
        run: profile.run,
        validTime: profile.validTime,
        fields: ["low_cloud_cover_average"],
      },
    );

    expect(response).toMatchObject({ isError: true });
  });
});
