import * as z from "zod/v4";
import {
  historicalAnalysisSourceSummarySchema,
} from "./history-result.js";
import {
  DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS,
  HISTORICAL_GFS_CYCLE_HOURS_UTC,
  MAX_HISTORICAL_TIME_SERIES_MAX_STEPS,
  historicalCycleHourUtcSchema,
  historicalGfsVariableIdSchema,
} from "./history.js";
import { historicalGfsFieldIdSchema } from "./history-fields.js";
import { nonIsobaricFieldResultSchema, gridPointSchema, profileLevelResultSchema } from "./result.js";
import { isoDateTimeSchema, pointCoordinateSchema, pressureLevelSchema } from "./query.js";

export const historicalFieldsTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  variables: z.array(historicalGfsVariableIdSchema).min(1).optional(),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1).optional(),
  fields: z.array(historicalGfsFieldIdSchema).min(1),
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema)
    .min(1)
    .max(HISTORICAL_GFS_CYCLE_HOURS_UTC.length)
    .default([...HISTORICAL_GFS_CYCLE_HOURS_UTC]),
  maxSteps: z.number().int().min(1).max(MAX_HISTORICAL_TIME_SERIES_MAX_STEPS)
    .default(DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS),
}).superRefine((query, context) => {
  if (new Date(query.startTime) > new Date(query.endTime)) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be greater than or equal to startTime" });
  }
  if ((query.variables !== undefined) !== (query.pressureLevelsHpa !== undefined)) {
    context.addIssue({
      code: "custom",
      path: query.variables ? ["pressureLevelsHpa"] : ["variables"],
      message: "Historical pressure variables and pressureLevelsHpa must be supplied together",
    });
  }
  if (new Set(query.cycleHoursUtc).size !== query.cycleHoursUtc.length) {
    context.addIssue({ code: "custom", path: ["cycleHoursUtc"], message: "cycleHoursUtc must not contain duplicates" });
  }
});

export const historicalFieldsTimeSeriesResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  requestedStartTime: z.string().datetime({ offset: true }),
  requestedEndTime: z.string().datetime({ offset: true }),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).optional(),
    pressureLevelsHpa: z.array(z.number().positive()).optional(),
    fields: z.array(historicalGfsFieldIdSchema).min(1),
    cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1),
  }),
  source: historicalAnalysisSourceSummarySchema,
  series: z.array(z.object({
    analysisTime: z.string().datetime({ offset: true }),
    levels: z.array(profileLevelResultSchema).optional(),
    fields: z.array(nonIsobaricFieldResultSchema).min(1),
    dataset: z.string().min(1),
    cacheHit: z.boolean(),
  })).min(1),
  caveat: z.literal("GFS model analysis fields; not direct observations or homogeneous climatological reanalysis"),
});

export type HistoricalFieldsTimeSeriesQueryInput = z.input<typeof historicalFieldsTimeSeriesQuerySchema>;
export type HistoricalFieldsTimeSeriesResult = z.infer<typeof historicalFieldsTimeSeriesResultSchema>;
