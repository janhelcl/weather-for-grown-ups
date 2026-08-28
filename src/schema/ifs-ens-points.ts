import * as z from "zod/v4";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import {
  ifsEnsMemberBundleResultSchema,
  ifsEnsMemberSchema,
  ifsEnsSelectionSchema,
} from "./ifs-ens.js";
import { IFS_ENS_MAX_NATIVE_STEPS } from "./ifs-ens-timeseries.js";
import { ifsRunSelectorSchema } from "./ifs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const IFS_ENS_POINTS_MAX = 20;
export const IFS_ENS_POINTS_DEFAULT_MAX_MEMBER_SAMPLES = 5_000;
export const IFS_ENS_POINTS_MAX_MEMBER_SAMPLES = 20_000;
export const IFS_ENS_POINTS_TIME_SERIES_DEFAULT_MAX_STEPS = 40;
export const IFS_ENS_POINTS_TIME_SERIES_DEFAULT_MAX_POINT_STEPS = 800;
export const IFS_ENS_POINTS_TIME_SERIES_MAX_POINT_STEPS = 5_000;

const ensembleSelectionShape = {
  members: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).default([...IFS_ENS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false),
  maxMemberSamples: z.number().int().min(1).max(IFS_ENS_POINTS_MAX_MEMBER_SAMPLES)
    .default(IFS_ENS_POINTS_DEFAULT_MAX_MEMBER_SAMPLES),
};

function validateEnsembleSelectors(
  query: { members: readonly string[]; quantiles: readonly number[] },
  context: z.RefinementCtx,
): void {
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "IFS ENS members must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantiles must not contain duplicates" });
  }
}

export const ifsEnsPointsQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(IFS_ENS_POINTS_MAX),
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on native ECMWF ENS cadence"),
  selection: ifsEnsSelectionSchema,
  ...ensembleSelectionShape,
}).superRefine(validateEnsembleSelectors);

const pointResultSchema = z.object({
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  pressureSummaries: ifsEnsMemberBundleResultSchema.shape.pressureSummaries,
  fieldSummaries: ifsEnsMemberBundleResultSchema.shape.fieldSummaries,
  members: ifsEnsMemberBundleResultSchema.shape.members,
  allCacheHit: z.boolean(),
});

export const ifsEnsPointsResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  selection: ifsEnsMemberBundleResultSchema.shape.selection,
  includeMembers: z.boolean(),
  points: z.array(pointResultSchema).min(1).max(IFS_ENS_POINTS_MAX),
  source: z.object({
    provider: z.literal("ECMWF Open Data"),
    access: z.literal("indexed_http_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("ifs_0p25_enfo_ef"),
    horizontalGridDegrees: z.literal(0.25),
    allCacheHit: z.boolean(),
    memberSemantics: z.literal("50_perturbed_members_control_is_oper_fc"),
  }),
});

export const ifsEnsPointsTimeSeriesQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(IFS_ENS_POINTS_MAX),
  run: ifsRunSelectorSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  selection: ifsEnsSelectionSchema,
  ...ensembleSelectionShape,
  maxSteps: z.number().int().min(1).max(IFS_ENS_MAX_NATIVE_STEPS)
    .default(IFS_ENS_POINTS_TIME_SERIES_DEFAULT_MAX_STEPS),
  maxPointSteps: z.number().int().min(1).max(IFS_ENS_POINTS_TIME_SERIES_MAX_POINT_STEPS)
    .default(IFS_ENS_POINTS_TIME_SERIES_DEFAULT_MAX_POINT_STEPS),
}).superRefine((query, context) => {
  validateEnsembleSelectors(query, context);
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be at or after startTime" });
  }
});

const timeStepSchema = z.object({
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  points: z.array(pointResultSchema).min(1).max(IFS_ENS_POINTS_MAX),
  allCacheHit: z.boolean(),
});

export const ifsEnsPointsTimeSeriesResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  run: isoDateTimeSchema,
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  cadence: z.literal("ecmwf_ens_native_3h_through_f144_then_6h_on_00_12z"),
  selection: ifsEnsMemberBundleResultSchema.shape.selection,
  includeMembers: z.boolean(),
  series: z.array(timeStepSchema).min(1).max(IFS_ENS_MAX_NATIVE_STEPS),
  source: z.object({
    provider: z.literal("ECMWF Open Data"),
    access: z.literal("indexed_http_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("ifs_0p25_enfo_ef"),
    horizontalGridDegrees: z.literal(0.25),
    allCacheHit: z.boolean(),
    memberSemantics: z.literal("50_perturbed_members_control_is_oper_fc"),
  }),
});

export type IfsEnsPointsQueryInput = z.input<typeof ifsEnsPointsQuerySchema>;
export type IfsEnsPointsResult = z.infer<typeof ifsEnsPointsResultSchema>;
export type IfsEnsPointsTimeSeriesQueryInput = z.input<typeof ifsEnsPointsTimeSeriesQuerySchema>;
export type IfsEnsPointsTimeSeriesResult = z.infer<typeof ifsEnsPointsTimeSeriesResultSchema>;
