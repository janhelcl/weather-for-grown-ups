import * as z from "zod/v4";
import { GEFS_MEMBERS } from "../catalog/gefs.js";
import { gefsMemberSchema, gefsRunSelectorSchema } from "./gefs-ensemble.js";
import {
  gefsBundleSelectionSchema,
  gefsMemberBundleResultSchema,
} from "./gefs-member-bundle.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const GEFS_BUNDLE_MAX_POINTS = 20;
export const GEFS_POINTS_BUNDLE_DEFAULT_MAX_MEMBER_SAMPLES = 5_000;
export const GEFS_POINTS_BUNDLE_MAX_MEMBER_SAMPLES = 20_000;

export const gefsPointsBundleQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(GEFS_BUNDLE_MAX_POINTS),
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native three-hour GEFS cadence"),
  selection: gefsBundleSelectionSchema,
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false),
  maxMemberSamples: z.number().int().min(1).max(GEFS_POINTS_BUNDLE_MAX_MEMBER_SAMPLES).default(GEFS_POINTS_BUNDLE_DEFAULT_MAX_MEMBER_SAMPLES),
}).superRefine((query, context) => {
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
});

const pointResultSchema = z.object({
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  pressureSummaries: gefsMemberBundleResultSchema.shape.pressureSummaries,
  fieldSummaries: gefsMemberBundleResultSchema.shape.fieldSummaries,
  members: gefsMemberBundleResultSchema.shape.members,
});

export const gefsPointsBundleResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  selection: gefsMemberBundleResultSchema.shape.selection,
  includeMembers: z.boolean(),
  points: z.array(pointResultSchema).min(1).max(GEFS_BUNDLE_MAX_POINTS),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    memberFiles: z.array(z.object({
      member: gefsMemberSchema,
      cacheHit: z.boolean(),
    })).min(2),
    allCacheHit: z.boolean(),
  }),
});

export type GefsPointsBundleQueryInput = z.input<typeof gefsPointsBundleQuerySchema>;
export type GefsPointsBundleResult = z.infer<typeof gefsPointsBundleResultSchema>;
