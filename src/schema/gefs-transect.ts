import * as z from "zod/v4";
import { GEFS_MEMBERS } from "../catalog/gefs.js";
import { GEFS_BUNDLE_MAX_POINTS, gefsPointsBundleResultSchema } from "./gefs-points-bundle.js";
import { gefsMemberSchema, gefsRunSelectorSchema } from "./gefs-ensemble.js";
import { gefsBundleSelectionSchema } from "./gefs-member-bundle.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const DEFAULT_GEFS_TRANSECT_SAMPLES = 20;
export const MAX_GEFS_TRANSECT_SAMPLES = GEFS_BUNDLE_MAX_POINTS;

export const gefsTransectQuerySchema = z.object({
  start: pointCoordinateSchema.describe("Transect start coordinate"),
  end: pointCoordinateSchema.describe("Transect end coordinate"),
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time shared by every transect sample"),
  selection: gefsBundleSelectionSchema,
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false),
  maxMemberSamples: z.number().int().min(1).max(20_000).default(5_000),
  samples: z.number().int().min(2).max(MAX_GEFS_TRANSECT_SAMPLES).default(DEFAULT_GEFS_TRANSECT_SAMPLES),
}).superRefine((query, context) => {
  if (query.start.latitude === query.end.latitude && query.start.longitude === query.end.longitude) {
    context.addIssue({ code: "custom", path: ["end"], message: "Transect start and end coordinates must differ" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
});

const pointSampleSchema = gefsPointsBundleResultSchema.shape.points.element;
const sampleSchema = pointSampleSchema.extend({
  index: z.number().int().nonnegative(),
  fraction: z.number().min(0).max(1),
  distanceKm: z.number().nonnegative(),
});

export const gefsTransectResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  startPoint: pointCoordinateSchema,
  endPoint: pointCoordinateSchema,
  totalDistanceKm: z.number().nonnegative(),
  selection: gefsPointsBundleResultSchema.shape.selection,
  includeMembers: z.boolean(),
  samples: z.array(sampleSchema).min(2).max(MAX_GEFS_TRANSECT_SAMPLES),
  source: gefsPointsBundleResultSchema.shape.source,
});

export type GefsTransectQueryInput = z.input<typeof gefsTransectQuerySchema>;
export type GefsTransectResult = z.infer<typeof gefsTransectResultSchema>;
