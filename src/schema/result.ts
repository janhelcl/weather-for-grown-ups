import * as z from "zod/v4";
import {
  NON_ISOBARIC_NAMED_LAYER_IDS,
  NON_ISOBARIC_NAMED_LEVEL_IDS,
} from "../catalog/non-isobaric-fields.js";

export const sourceProvenanceSchema = z.object({
  provider: z.union([z.literal("NOAA NOMADS"), z.literal("NOAA AWS Open Data")]),
  access: z.union([z.literal("nomads_grib_filter"), z.literal("s3_range")]),
  decoder: z.literal("wgrib2"),
});

export const profileLevelResultSchema = z.object({
  pressureHpa: z.number(),
  temperatureC: z.number().optional(),
  relativeHumidityPct: z.number().optional(),
  uWindMs: z.number().optional(),
  vWindMs: z.number().optional(),
  geopotentialHeightGpm: z.number().optional(),
  specificHumidityKgKg: z.number().optional(),
  verticalVelocityPaS: z.number().optional(),
  geometricVerticalVelocityMs: z.number().optional(),
  absoluteVorticityS1: z.number().optional(),
  totalCloudCoverPct: z.number().optional(),
  cloudWaterMixingRatioKgKg: z.number().optional(),
  ozoneMixingRatioKgKg: z.number().optional(),
  windSpeedMs: z.number().optional(),
  windDirectionDeg: z.number().optional(),
});

export const nonIsobaricFieldLevelResultSchema = z.union([
  z.object({ type: z.literal("surface") }),
  z.object({ type: z.literal("height_above_ground_m"), heightM: z.number() }),
  z.object({ type: z.literal("named_layer"), id: z.enum(NON_ISOBARIC_NAMED_LAYER_IDS) }),
  z.object({ type: z.literal("named_level"), id: z.enum(NON_ISOBARIC_NAMED_LEVEL_IDS) }),
]);

const intervalTemporalResultShape = {
  startForecastHour: z.number(),
  endForecastHour: z.number(),
  startTime: z.string(),
  endTime: z.string(),
};

export const fieldTemporalResultSchema = z.union([
  z.object({ type: z.literal("instantaneous") }),
  z.object({ type: z.literal("accumulation"), ...intervalTemporalResultShape }),
  z.object({ type: z.literal("average"), ...intervalTemporalResultShape }),
]);

export const nonIsobaricFieldResultSchema = z.object({
  id: z.string(),
  level: nonIsobaricFieldLevelResultSchema,
  temporal: fieldTemporalResultSchema,
  values: z.record(z.string(), z.number()),
});

const gridPointSchema = z.object({ latitude: z.number(), longitude: z.number() });

export const profileResultSchema = z.object({
  model: z.literal("gfs_0p25"),
  run: z.string(),
  validTime: z.string(),
  forecastHour: z.number(),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  levels: z.array(profileLevelResultSchema),
  fields: z.array(nonIsobaricFieldResultSchema).optional(),
  source: sourceProvenanceSchema.extend({ cacheHit: z.boolean() }),
});

export const timeSeriesResultSchema = z.object({
  model: z.literal("gfs_0p25"),
  run: z.string(),
  requestedStartTime: z.string(),
  requestedEndTime: z.string(),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  source: sourceProvenanceSchema,
  series: z.array(z.object({
    validTime: z.string(),
    forecastHour: z.number(),
    levels: z.array(profileLevelResultSchema),
    fields: z.array(nonIsobaricFieldResultSchema).optional(),
    cacheHit: z.boolean(),
  })),
});

export const areaSummaryResultSchema = z.object({
  model: z.literal("gfs_0p25"),
  run: z.string(),
  validTime: z.string(),
  forecastHour: z.number(),
  bbox: z.object({
    westLongitude: z.number(),
    eastLongitude: z.number(),
    southLatitude: z.number(),
    northLatitude: z.number(),
  }),
  variable: z.object({
    id: z.string(),
    pressureHpa: z.number(),
    field: z.string(),
    unit: z.string(),
  }),
  statistics: z.object({
    definedGridPoints: z.number(),
    mean: z.number(),
    min: z.number(),
    max: z.number(),
    meanKind: z.literal("unweighted_grid_point_mean"),
  }),
  source: z.object({
    provider: z.literal("NOAA NOMADS"),
    access: z.literal("nomads_grib_filter"),
    decoder: z.literal("wgrib2"),
    cacheHit: z.boolean(),
  }),
});

export const latestGfsRunResultSchema = z.object({
  model: z.literal("gfs_0p25"),
  run: z.string(),
  completeness: z.literal("f384"),
  discoverySource: z.literal("NOAA AWS Open Data"),
});
