import { describe, expect, it } from "vitest";
import type { ProfileResult } from "../src/core/types.js";
import { handleGetGfsProfile } from "../src/mcp-tool.js";
import {
  batchPointsResultSchema,
  profileResultSchema,
  timeSeriesResultSchema,
} from "../src/schema/result.js";

const derivedLevel = {
  pressureHpa: 850,
  temperatureC: 12,
  relativeHumidityPct: 65,
  specificHumidityKgKg: 0.006,
  dewPointC: 5.6222,
  potentialTemperatureK: 298.6876,
  mixingRatioKgKg: 0.0060362,
  virtualTemperatureC: 13.0397,
  airDensityKgM3: 1.03468,
  wetBulbTemperatureC: 7.691,
  equivalentPotentialTemperatureK: 316.758,
};

const profile: ProfileResult = {
  model: "gfs_0p25",
  run: "2026-08-20T06:00:00.000Z",
  validTime: "2026-08-20T09:00:00.000Z",
  forecastHour: 3,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  levels: [derivedLevel],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    cacheHit: false,
  },
};

describe("derived meteorology shared result contract", () => {
  it("accepts thermodynamic diagnostics in the profile contract", () => {
    expect(profileResultSchema.parse(profile).levels[0]).toEqual(derivedLevel);
  });

  it("uses the same pressure-level contract in batch and time-series results", () => {
    const batch = batchPointsResultSchema.parse({
      model: "gfs_0p25",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      points: [{
        requestedPoint: profile.requestedPoint,
        gridPoint: profile.gridPoint,
        levels: [derivedLevel],
      }],
      source: profile.source,
    });
    expect(batch.points[0]?.levels[0]).toEqual(derivedLevel);

    const series = timeSeriesResultSchema.parse({
      model: "gfs_0p25",
      run: profile.run,
      requestedStartTime: profile.validTime,
      requestedEndTime: profile.validTime,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      source: {
        provider: profile.source.provider,
        access: profile.source.access,
        decoder: profile.source.decoder,
      },
      series: [{
        validTime: profile.validTime,
        forecastHour: profile.forecastHour,
        levels: [derivedLevel],
        cacheHit: false,
      }],
    });
    expect(series.series[0]?.levels[0]).toEqual(derivedLevel);
  });

  it("returns thermodynamic diagnostics through the MCP profile boundary", async () => {
    const response = await handleGetGfsProfile(
      { getProfile: async () => profile },
      {
        latitude: profile.requestedPoint.latitude,
        longitude: profile.requestedPoint.longitude,
        run: profile.run,
        validTime: profile.validTime,
        variables: [
          "dew_point",
          "potential_temperature",
          "mixing_ratio",
          "virtual_temperature",
          "air_density",
          "wet_bulb_temperature",
          "equivalent_potential_temperature",
        ],
        pressureLevelsHpa: [850],
        source: "s3",
      },
    );

    expect(response).not.toHaveProperty("isError");
    if (!("structuredContent" in response)) throw new Error("Expected MCP success response");
    expect(response.structuredContent.levels[0]).toEqual(derivedLevel);
  });
});
