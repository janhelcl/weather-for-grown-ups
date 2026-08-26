import * as z from "zod/v4";
import { historicalGfsFieldIdSchema } from "./history-fields.js";
import {
  historicalAnalysisTimeSchema,
  historicalGfsVariableIdSchema,
} from "./history.js";
import {
  gridPointSchema,
  nonIsobaricFieldResultSchema,
  profileLevelResultSchema,
} from "./result.js";
import { pointCoordinateSchema, pressureLevelSchema } from "./query.js";

export const MAX_HISTORICAL_POINTS = 10;

export const historicalPointsQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(MAX_HISTORICAL_POINTS),
  analysisTime: historicalAnalysisTimeSchema,
  variables: z.array(historicalGfsVariableIdSchema).min(1).optional(),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1).optional(),
  fields: z.array(historicalGfsFieldIdSchema).min(1).optional(),
}).superRefine((query, context) => {
  const hasVariables = query.variables !== undefined;
  const hasLevels = query.pressureLevelsHpa !== undefined;
  if (hasVariables !== hasLevels) {
    context.addIssue({
      code: "custom",
      path: hasVariables ? ["pressureLevelsHpa"] : ["variables"],
      message: "Historical pressure variables and pressureLevelsHpa must be supplied together",
    });
  }
  if (!hasVariables && query.fields === undefined) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Request at least one historical pressure variable or non-isobaric field",
    });
  }
});

export const historicalPointResultSchema = z.object({
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  levels: z.array(profileLevelResultSchema).optional(),
  fields: z.array(nonIsobaricFieldResultSchema).optional(),
  dataset: z.string().min(1),
  cacheHit: z.boolean(),
});

export const historicalPointsResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  analysisTime: historicalAnalysisTimeSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).optional(),
    pressureLevelsHpa: z.array(z.number().positive()).optional(),
    fields: z.array(historicalGfsFieldIdSchema).optional(),
  }),
  points: z.array(historicalPointResultSchema).min(1),
  source: z.object({
    provider: z.literal("NOAA NCEI"),
    access: z.literal("ncei_thredds_ncss"),
    composition: z.literal("serial_point_queries"),
  }),
  caveat: z.literal(
    "GFS model analysis; not direct observations or homogeneous climatological reanalysis",
  ),
});

export type HistoricalPointsQueryInput = z.input<typeof historicalPointsQuerySchema>;
export type HistoricalPointsResult = z.infer<typeof historicalPointsResultSchema>;
