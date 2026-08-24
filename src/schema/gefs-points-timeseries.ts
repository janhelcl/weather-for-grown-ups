import * as z from "zod/v4";
import { GEFS_MEMBERS, isSupportedGefsPressureSelection } from "../catalog/gefs.js";
import {
  gefsMemberSchema,
  gefsPressureVariableSchema,
  gefsRunSelectorSchema,
} from "./gefs-ensemble.js";
import { GEFS_MAX_TIME_SERIES_STEPS } from "./gefs-ensemble-timeseries.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const GEFS_POINTS_TIME_SERIES_MAX_POINTS = 20;
export const DEFAULT_GEFS_POINTS_TIME_SERIES_MAX_STEPS = 80;
export const DEFAULT_GEFS_POINTS_TIME_SERIES_MAX_SAMPLES = 1_600;
export const MAX_GEFS_POINTS_TIME_SERIES_MAX_SAMPLES = 5_000;

export const gefsPointsTimeSeriesQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(GEFS_POINTS_TIME_SERIES_MAX_POINTS),
  run: gefsRunSelectorSchema,
  startTime: isoDateTimeSchema.describe("First forecast valid time on the native three-hour GEFS cadence"),
  endTime: isoDateTimeSchema.describe("Last forecast valid time on the native three-hour GEFS cadence, inclusive"),
  variable: gefsPressureVariableSchema.describe("One raw GEFS pgrb2a pressure-level variable"),
  pressureLevelHpa: z.number().positive().describe("Pressure surface in hPa; support depends on the selected pgrb2a variable"),
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  thresholdGte: z.number().optional().describe(
    "Optional threshold in normalized output units; each point-step reports the raw share of requested members meeting or exceeding it, not a calibrated probability",
  ),
  includeMembers: z.boolean().default(false).describe(
    "Include every member value at every point and time step. Defaults false to keep agent responses compact; summaries are always returned.",
  ),
  maxSteps: z.number().int().min(1).max(GEFS_MAX_TIME_SERIES_STEPS).default(DEFAULT_GEFS_POINTS_TIME_SERIES_MAX_STEPS),
  maxSamples: z.number().int().min(1).max(MAX_GEFS_POINTS_TIME_SERIES_MAX_SAMPLES).default(DEFAULT_GEFS_POINTS_TIME_SERIES_MAX_SAMPLES),
}).superRefine((query, context) => {
  if (!isSupportedGefsPressureSelection(query.variable, query.pressureLevelHpa)) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelHpa"],
      message: `GEFS pgrb2a does not publish ${query.variable} at ${query.pressureLevelHpa} hPa in the WFG ensemble contract`,
    });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
  const start = new Date(query.startTime);
  const end = new Date(query.endTime);
  if (end.getTime() < start.getTime()) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be at or after startTime" });
  }
});

const quantileValueSchema = z.object({
  quantile: z.number().min(0).max(1),
  value: z.number(),
});

const distributionSummarySchema = z.object({
  memberCount: z.number().int().min(2),
  mean: z.number(),
  populationStdDev: z.number().nonnegative(),
  min: z.number(),
  max: z.number(),
  quantiles: z.array(quantileValueSchema).min(1),
  threshold: z.object({
    operator: z.literal("gte"),
    value: z.number(),
    count: z.number().int().nonnegative(),
    fraction: z.number().min(0).max(1),
    interpretation: z.literal("raw_member_fraction_not_calibrated_probability"),
  }).optional(),
});

const memberValueSchema = z.object({
  member: gefsMemberSchema,
  value: z.number(),
});

const pointStepSchema = z.object({
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  summary: distributionSummarySchema,
  members: z.array(memberValueSchema).min(2).optional(),
});

export const gefsPointsTimeSeriesResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  stepHours: z.literal(3),
  selection: z.object({
    variable: gefsPressureVariableSchema,
    gfsCode: z.string().min(1),
    pressureLevelHpa: z.number().positive(),
    outputField: z.string().min(1),
    unit: z.string().min(1),
    members: z.array(gefsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
    thresholdGte: z.number().optional(),
  }),
  includeMembers: z.boolean(),
  series: z.array(z.object({
    validTime: isoDateTimeSchema,
    forecastHour: z.number().int().min(0).max(384),
    points: z.array(pointStepSchema).min(1).max(GEFS_POINTS_TIME_SERIES_MAX_POINTS),
    allCacheHit: z.boolean(),
  })).min(1).max(GEFS_MAX_TIME_SERIES_STEPS),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsPointsTimeSeriesQuery = z.output<typeof gefsPointsTimeSeriesQuerySchema>;
export type GefsPointsTimeSeriesQueryInput = z.input<typeof gefsPointsTimeSeriesQuerySchema>;
export type GefsPointsTimeSeriesResult = z.infer<typeof gefsPointsTimeSeriesResultSchema>;
