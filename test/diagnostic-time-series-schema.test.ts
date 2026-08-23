import { describe, expect, it } from "vitest";
import {
  diagnosticTimeSeriesQuerySchema,
} from "../src/schema/diagnostic-time-series.js";
import { diagnosticTimeSeriesResultSchema } from "../src/schema/diagnostic-time-series-result.js";
import { DEFAULT_TIME_SERIES_MAX_STEPS } from "../src/schema/query.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-23T06:00:00Z",
  startTime: "2026-08-23T12:00:00Z",
  endTime: "2026-08-23T15:00:00Z",
};

describe("diagnosticTimeSeriesQuerySchema", () => {
  it("supports all three diagnostic families and defaults multi-time access to S3", () => {
    const layer = diagnosticTimeSeriesQuerySchema.parse({
      ...base,
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate", "wind_shear"],
      },
    });
    expect(layer.source).toBe("s3");
    expect(layer.maxSteps).toBe(DEFAULT_TIME_SERIES_MAX_STEPS);

    expect(diagnosticTimeSeriesQuerySchema.safeParse({
      ...base,
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
        diagnostics: ["freezing_level_crossings"],
      },
    }).success).toBe(true);

    expect(diagnosticTimeSeriesQuerySchema.safeParse({
      ...base,
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
        parcel: "surface_2m",
      },
    }).success).toBe(true);
  });

  it("rejects reversed time ranges and invalid layer ordering", () => {
    expect(diagnosticTimeSeriesQuerySchema.safeParse({
      ...base,
      startTime: "2026-08-23T15:00:00Z",
      endTime: "2026-08-23T12:00:00Z",
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 700,
        upperPressureHpa: 850,
        diagnostics: ["wind_shear"],
      },
    }).success).toBe(false);
  });

  it("requires distinct published profile and parcel pressure levels", () => {
    expect(diagnosticTimeSeriesQuerySchema.safeParse({
      ...base,
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 850],
        diagnostics: ["temperature_inversion_layers"],
      },
    }).success).toBe(false);

    expect(diagnosticTimeSeriesQuerySchema.safeParse({
      ...base,
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [700, 700],
        parcel: "mixed_layer_100hpa",
      },
    }).success).toBe(false);

    expect(diagnosticTimeSeriesQuerySchema.safeParse({
      ...base,
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [875, 850],
        diagnostics: ["freezing_level_crossings"],
      },
    }).success).toBe(false);
  });
});

describe("diagnosticTimeSeriesResultSchema", () => {
  const result = {
    model: "gfs_0p25" as const,
    run: "2026-08-23T06:00:00.000Z",
    requestedStartTime: "2026-08-23T12:00:00.000Z",
    requestedEndTime: "2026-08-23T13:00:00.000Z",
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    source: { provider: "NOAA AWS Open Data" as const, access: "s3_range" as const, decoder: "wgrib2" as const },
    diagnostic: {
      kind: "layer" as const,
      lowerPressureHpa: 850,
      upperPressureHpa: 700,
      diagnostics: ["temperature_lapse_rate" as const],
    },
    series: [{
      kind: "layer" as const,
      validTime: "2026-08-23T12:00:00.000Z",
      forecastHour: 6,
      layer: {
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        lowerGeopotentialHeightGpm: 1500,
        upperGeopotentialHeightGpm: 3000,
        depthGpm: 1500,
      },
      diagnostics: [{ id: "temperature_lapse_rate" as const, values: { temperatureLapseRateCPerKm: 6.5 } }],
      cacheHit: false,
    }],
  };

  it("accepts compact diagnostic steps", () => {
    expect(diagnosticTimeSeriesResultSchema.parse(result).series).toHaveLength(1);
  });

  it("rejects a step from a different diagnostic family", () => {
    const mismatched = {
      ...result,
      series: [{
        kind: "profile" as const,
        validTime: "2026-08-23T12:00:00.000Z",
        forecastHour: 6,
        diagnostics: [{ id: "freezing_level_crossings" as const, crossings: [] }],
        cacheHit: false,
      }],
    };
    expect(diagnosticTimeSeriesResultSchema.safeParse(mismatched).success).toBe(false);
  });
});
