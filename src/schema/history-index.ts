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

export const DEFAULT_HISTORICAL_BACKFILL_MAX_FETCHES = 16;
export const MAX_HISTORICAL_BACKFILL_MAX_FETCHES = 256;
export const MAX_HISTORICAL_BACKFILL_SELECTED_CYCLES = 50_000;

export const historicalIndexBackfillQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  variables: z.array(historicalGfsVariableIdSchema).min(1),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1),
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1).default([0, 6, 12, 18]),
  maxFetches: z.number().int().min(1).max(MAX_HISTORICAL_BACKFILL_MAX_FETCHES)
    .default(DEFAULT_HISTORICAL_BACKFILL_MAX_FETCHES),
  order: z.enum(["oldest_first", "newest_first"]).default("oldest_first"),
  dryRun: z.boolean().default(false),
  continueOnError: z.boolean().default(false),
}).superRefine((query, context) => {
  if (new Date(query.startTime) > new Date(query.endTime)) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be greater than or equal to startTime" });
  }
  if (new Set(query.cycleHoursUtc).size !== query.cycleHoursUtc.length) {
    context.addIssue({ code: "custom", path: ["cycleHoursUtc"], message: "cycleHoursUtc must not contain duplicates" });
  }
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

export const historicalIndexBackfillResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  indexPath: z.string().min(1),
  requestedStartTime: z.string().datetime({ offset: true }),
  requestedEndTime: z.string().datetime({ offset: true }),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
    cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1),
    order: z.enum(["oldest_first", "newest_first"]),
  }),
  selectedCycleCount: z.number().int().nonnegative(),
  alreadyMaterialized: z.number().int().nonnegative(),
  fetchBudget: z.number().int().positive(),
  attempted: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  upstreamFetches: z.number().int().nonnegative(),
  materialized: z.number().int().nonnegative(),
  analysisTimesMaterialized: z.array(historicalAnalysisTimeSchema),
  failures: z.array(z.object({ analysisTime: historicalAnalysisTimeSchema, message: z.string().min(1) })),
  remaining: z.number().int().nonnegative(),
  nextAnalysisTime: historicalAnalysisTimeSchema.nullable(),
  status: z.enum(["complete", "budget_exhausted", "stopped_on_error", "dry_run"]),
  note: z.literal("resumable backfill skips materialized Grid 4 analyses before fetch; archive access remains serial and NOAA-paced"),
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
export type HistoricalIndexBackfillQueryInput = z.input<typeof historicalIndexBackfillQuerySchema>;
export type HistoricalAnalogQueryInput = z.input<typeof historicalAnalogQuerySchema>;
export type HistoricalIndexRecord = z.infer<typeof historicalIndexRecordSchema>;
export type HistoricalIndexBuildResult = z.infer<typeof historicalIndexBuildResultSchema>;
export type HistoricalIndexBackfillResult = z.infer<typeof historicalIndexBackfillResultSchema>;
export type HistoricalAnalogResult = z.infer<typeof historicalAnalogResultSchema>;
