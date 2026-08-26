import * as z from "zod/v4";
import { historicalGfsFieldIdSchema } from "./history-fields.js";
import {
  DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS,
  HISTORICAL_GFS_CYCLE_HOURS_UTC,
  MAX_HISTORICAL_TIME_SERIES_MAX_STEPS,
  historicalCycleHourUtcSchema,
  historicalGfsVariableIdSchema,
} from "./history.js";
import { historicalPointResultSchema, MAX_HISTORICAL_POINTS } from "./history-points.js";
import { isoDateTimeSchema, pointCoordinateSchema, pressureLevelSchema } from "./query.js";

export const DEFAULT_HISTORICAL_POINTS_TIME_SERIES_MAX_POINT_STEPS = 32;
export const MAX_HISTORICAL_POINTS_TIME_SERIES_MAX_POINT_STEPS = 80;

export const historicalPointsTimeSeriesQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(MAX_HISTORICAL_POINTS),
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  variables: z.array(historicalGfsVariableIdSchema).min(1).optional(),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1).optional(),
  fields: z.array(historicalGfsFieldIdSchema).min(1).optional(),
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema)
    .min(1)
    .max(HISTORICAL_GFS_CYCLE_HOURS_UTC.length)
    .default([...HISTORICAL_GFS_CYCLE_HOURS_UTC]),
  maxSteps: z.number().int().min(1).max(MAX_HISTORICAL_TIME_SERIES_MAX_STEPS)
    .default(DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS),
  maxPointSteps: z.number().int().min(1).max(MAX_HISTORICAL_POINTS_TIME_SERIES_MAX_POINT_STEPS)
    .default(DEFAULT_HISTORICAL_POINTS_TIME_SERIES_MAX_POINT_STEPS),
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
  if (query.variables === undefined && query.fields === undefined) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Request at least one historical pressure variable or non-isobaric field",
    });
  }
  if (new Set(query.cycleHoursUtc).size !== query.cycleHoursUtc.length) {
    context.addIssue({ code: "custom", path: ["cycleHoursUtc"], message: "cycleHoursUtc must not contain duplicates" });
  }
});

export const historicalPointsTimeSeriesResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).optional(),
    pressureLevelsHpa: z.array(z.number().positive()).optional(),
    fields: z.array(historicalGfsFieldIdSchema).optional(),
    cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1),
  }),
  source: z.object({
    provider: z.literal("NOAA NCEI"),
    access: z.literal("ncei_thredds_ncss"),
    composition: z.literal("serial_cycle_point_queries"),
  }),
  series: z.array(z.object({
    analysisTime: z.string().datetime({ offset: true }),
    points: z.array(historicalPointResultSchema).min(1),
  })).min(1),
  caveat: z.literal(
    "GFS model analysis; not direct observations or homogeneous climatological reanalysis",
  ),
});

export type HistoricalPointsTimeSeriesQueryInput = z.input<typeof historicalPointsTimeSeriesQuerySchema>;
export type HistoricalPointsTimeSeriesResult = z.infer<typeof historicalPointsTimeSeriesResultSchema>;
