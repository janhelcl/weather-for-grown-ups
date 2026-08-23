import * as z from "zod/v4";
import { gridPointSchema, profileLevelResultSchema } from "./result.js";
import { isoDateTimeSchema, pressureLevelSchema, variableIdSchema } from "./query.js";

export const transectSampleResultSchema = z.object({
  index: z.number().int().nonnegative(),
  fraction: z.number().min(0).max(1),
  distanceKm: z.number().nonnegative(),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  levels: z.array(profileLevelResultSchema),
});

export const transectResultSchema = z.object({
  model: z.literal("gfs_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  startPoint: gridPointSchema,
  endPoint: gridPointSchema,
  totalDistanceKm: z.number().nonnegative(),
  variables: z.array(variableIdSchema).min(1),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1),
  samples: z.array(transectSampleResultSchema).min(2),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    cacheHit: z.boolean(),
  }),
});
