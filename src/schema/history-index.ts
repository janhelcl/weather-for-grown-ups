import * as z from "zod/v4";
import {
  DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS,
  historicalAnalysisTimeSchema,
  historicalCycleHourUtcSchema,
  historicalGfsVariableIdSchema,
} from "./history.js";
import { gridPointSchema, profileLevelResultSchema } from "./result.js";
import { isoDateTimeSchema, pointCoordinateSchema, pressureLevelSchema } from "./query.js";

export const historicalIndexBuildQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  variables: z.array(historicalGfsVariableIdSchema).min(1),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1),
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1).default([0, 6, 12, 18]),
  maxSteps: z.number().int().min(1).max(16).default(DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS),
});

export const historicalAnalogQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  targetTime: historicalAnalysisTimeSchema,
  variables: z.array(historicalGfsVariableIdSchema).min(1),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1),
  count: z.number().int().min(1).max(20).default(5),
  excludeWithinHours: z.number().int().min(0).max(24 * 31).default(24),
  fetchTargetIfMissing: z.boolean().default(true),
});

export const historicalIndexRecordSchema = z.object({
  version: z.literal(1),
  model: z.literal("gfs_grid4_analysis_0p5"),
  analysisTime: historicalAnalysisTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
  }),
  levels: z.array(profileLevelResultSchema).min(1),
  source: z.object({
    provider: z.literal("NOAA NCEI"),
    access: z.literal("ncei_thredds_ncss"),
    dataset: z.string().min(1),
  }),
});

export const historicalIndexBuildResultSchema = z.object({
  indexPath: z.string().min(1),
  requestedStartTime: z.string().datetime({ offset: true }),
  requestedEndTime: z.string().datetime({ offset: true }),
  materialized: z.number().int().nonnegative(),
  totalMatchingRecords: z.number().int().nonnegative(),
  analysisTimes: z.array(historicalAnalysisTimeSchema),
  note: z.literal("append-only local materialization; duplicate keys are deduplicated when read"),
});

export const historicalAnalogResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  targetTime: historicalAnalysisTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
  }),
  indexPath: z.string().min(1),
  metric: z.object({
    name: z.literal("standardized_euclidean"),
    features: z.array(z.string().min(1)).min(1),
    windRepresentation: z.literal("u_v_components"),
  }),
  candidateCount: z.number().int().nonnegative(),
  target: z.object({
    analysisTime: historicalAnalysisTimeSchema,
    levels: z.array(profileLevelResultSchema).min(1),
    dataset: z.string().min(1),
    fromIndex: z.boolean(),
  }),
  analogs: z.array(z.object({
    rank: z.number().int().positive(),
    analysisTime: historicalAnalysisTimeSchema,
    distance: z.number().nonnegative(),
    levels: z.array(profileLevelResultSchema).min(1),
    dataset: z.string().min(1),
  })),
  caveat: z.literal("Similarity is computed only from the selected GFS model-analysis variables and pressure levels; it is not a climatological or impact-specific similarity score"),
});

export type HistoricalIndexBuildQueryInput = z.input<typeof historicalIndexBuildQuerySchema>;
export type HistoricalAnalogQueryInput = z.input<typeof historicalAnalogQuerySchema>;
export type HistoricalIndexRecord = z.infer<typeof historicalIndexRecordSchema>;
export type HistoricalIndexBuildResult = z.infer<typeof historicalIndexBuildResultSchema>;
export type HistoricalAnalogResult = z.infer<typeof historicalAnalogResultSchema>;
