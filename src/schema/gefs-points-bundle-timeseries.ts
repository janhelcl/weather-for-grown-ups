import * as z from "zod/v4";
import { GEFS_MEMBERS } from "../catalog/gefs.js";
import { GEFS_TOTAL_NATIVE_FORECAST_STEPS } from "../core/gefs-time.js";
import { gefsMemberSchema, gefsRunSelectorSchema } from "./gefs-ensemble.js";
import { gefsBundleSelectionSchema } from "./gefs-member-bundle.js";
import {
  GEFS_BUNDLE_MAX_POINTS,
  gefsPointsBundleResultSchema,
} from "./gefs-points-bundle.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const GEFS_POINTS_BUNDLE_TIME_SERIES_DEFAULT_MAX_STEPS = 40;
export const GEFS_POINTS_BUNDLE_TIME_SERIES_DEFAULT_MAX_POINT_STEPS = 800;
export const GEFS_POINTS_BUNDLE_TIME_SERIES_MAX_POINT_STEPS = 5_000;
export const GEFS_POINTS_BUNDLE_TIME_SERIES_DEFAULT_MAX_MEMBER_SAMPLES = 5_000;
export const GEFS_POINTS_BUNDLE_TIME_SERIES_MAX_MEMBER_SAMPLES = 20_000;

export const gefsPointsBundleTimeSeriesQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(GEFS_BUNDLE_MAX_POINTS),
  run: gefsRunSelectorSchema,
  startTime: isoDateTimeSchema.describe("Inclusive first native three-hour GEFS valid time"),
  endTime: isoDateTimeSchema.describe("Inclusive last native three-hour GEFS valid time"),
  selection: gefsBundleSelectionSchema,
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false).describe(
    "Include raw member bundle values for every point-step. False is recommended for agent context efficiency.",
  ),
  maxSteps: z.number().int().min(1).max(GEFS_TOTAL_NATIVE_FORECAST_STEPS).default(GEFS_POINTS_BUNDLE_TIME_SERIES_DEFAULT_MAX_STEPS),
  maxPointSteps: z.number().int().min(1).max(GEFS_POINTS_BUNDLE_TIME_SERIES_MAX_POINT_STEPS).default(GEFS_POINTS_BUNDLE_TIME_SERIES_DEFAULT_MAX_POINT_STEPS).describe(
    "Maximum points × forecast steps returned",
  ),
  maxMemberSamples: z.number().int().min(1).max(GEFS_POINTS_BUNDLE_TIME_SERIES_MAX_MEMBER_SAMPLES).default(GEFS_POINTS_BUNDLE_TIME_SERIES_DEFAULT_MAX_MEMBER_SAMPLES).describe(
    "Guardrail for includeMembers: maximum point × forecast-step × member × scalar-output cells returned",
  ),
}).superRefine((query, context) => {
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be at or after startTime" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
});

const stepSchema = z.object({
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  points: gefsPointsBundleResultSchema.shape.points,
  allCacheHit: z.boolean(),
});

export const gefsPointsBundleTimeSeriesResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  stepHours: z.literal(3),
  selection: gefsPointsBundleResultSchema.shape.selection,
  includeMembers: z.boolean(),
  series: z.array(stepSchema).min(1).max(GEFS_TOTAL_NATIVE_FORECAST_STEPS),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsPointsBundleTimeSeriesQueryInput = z.input<typeof gefsPointsBundleTimeSeriesQuerySchema>;
export type GefsPointsBundleTimeSeriesResult = z.infer<typeof gefsPointsBundleTimeSeriesResultSchema>;
