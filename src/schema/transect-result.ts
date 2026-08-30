import * as z from "zod/v4";
import { operationalGfsModelIdSchema } from "./gfs-grid.js";
import { gridPointSchema, nonIsobaricFieldResultSchema, profileLevelResultSchema } from "./result.js";
import { isoDateTimeSchema, nonIsobaricFieldIdSchema, pressureLevelSchema, variableIdSchema } from "./query.js";

export const transectSampleResultSchema = z.object({
  index: z.number().int().nonnegative(),
  fraction: z.number().min(0).max(1),
  distanceKm: z.number().nonnegative(),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  levels: z.array(profileLevelResultSchema),
  fields: z.array(nonIsobaricFieldResultSchema).optional(),
});

export const transectResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  startPoint: gridPointSchema,
  endPoint: gridPointSchema,
  totalDistanceKm: z.number().nonnegative(),
  variables: z.array(variableIdSchema),
  pressureLevelsHpa: z.array(pressureLevelSchema),
  fields: z.array(nonIsobaricFieldIdSchema).min(1).optional(),
  samples: z.array(transectSampleResultSchema).min(2),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    cacheHit: z.boolean(),
  }),
}).superRefine((result, context) => {
  const hasVariables = result.variables.length > 0;
  const hasPressureLevels = result.pressureLevelsHpa.length > 0;
  if (hasVariables !== hasPressureLevels) {
    context.addIssue({
      code: "custom",
      path: hasVariables ? ["pressureLevelsHpa"] : ["variables"],
      message: "Pressure-level variables and pressureLevelsHpa must be present together",
    });
  }
  if (!hasVariables && result.fields === undefined) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Transect result must contain pressure-level variables or non-isobaric fields",
    });
  }
});
