import * as z from "zod/v4";
import { GEFS_MEMBERS, isSupportedGefsPressureSelection } from "../catalog/gefs.js";
import {
  gefsMemberSchema,
  gefsPressureVariableSchema,
  gefsRunSelectorSchema,
} from "./gefs-ensemble.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

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

export const gefsBatchPointsQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(20),
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native three-hour GEFS cadence"),
  variable: gefsPressureVariableSchema,
  pressureLevelHpa: z.number().positive(),
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  thresholdGte: z.number().optional(),
  includeMembers: z.boolean().default(false).describe("Include member values for every point; summaries are always returned"),
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
});

const memberValueSchema = z.object({
  member: gefsMemberSchema,
  value: z.number(),
});

export const gefsBatchPointsResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
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
  points: z.array(z.object({
    requestedPoint: pointCoordinateSchema,
    gridPoint: pointCoordinateSchema,
    summary: distributionSummarySchema,
    members: z.array(memberValueSchema).min(2).optional(),
  })).min(1).max(20),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    memberFiles: z.array(z.object({ member: gefsMemberSchema, cacheHit: z.boolean() })).min(2),
    allCacheHit: z.boolean(),
  }),
});

export type GefsBatchPointsQueryInput = z.input<typeof gefsBatchPointsQuerySchema>;
export type GefsBatchPointsResult = z.infer<typeof gefsBatchPointsResultSchema>;
