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

export const gefsRunComparisonQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  anchorRun: gefsRunSelectorSchema.describe("Newest GEFS cycle in the comparison; 'latest' is query-aware for the requested valid time and members"),
  validTime: isoDateTimeSchema.describe("One valid time compared across consecutive six-hour GEFS cycles"),
  variable: gefsPressureVariableSchema,
  pressureLevelHpa: z.number().positive(),
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  thresholdGte: z.number().optional(),
  cycles: z.number().int().min(2).max(6).default(3),
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

const runSnapshotSchema = z.object({
  run: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  summary: distributionSummarySchema,
  allCacheHit: z.boolean(),
});

const scalarShiftSchema = z.object({
  from: z.number(),
  to: z.number(),
  delta: z.number(),
});

const transitionSchema = z.object({
  fromRun: isoDateTimeSchema,
  toRun: isoDateTimeSchema,
  fromForecastHour: z.number().int().min(0).max(384),
  toForecastHour: z.number().int().min(0).max(384),
  mean: scalarShiftSchema,
  populationStdDev: scalarShiftSchema,
  min: scalarShiftSchema,
  max: scalarShiftSchema,
  quantiles: z.array(z.object({
    quantile: z.number().min(0).max(1),
    from: z.number(),
    to: z.number(),
    delta: z.number(),
  })).min(1),
  thresholdFraction: z.object({
    operator: z.literal("gte"),
    threshold: z.number(),
    from: z.number().min(0).max(1),
    to: z.number().min(0).max(1),
    delta: z.number().min(-1).max(1),
  }).optional(),
  interpretation: z.literal("distribution_shift_between_model_cycles_not_member_trajectory"),
});

export const gefsRunComparisonResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  validTime: isoDateTimeSchema,
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  anchorRun: isoDateTimeSchema,
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
  runs: z.array(runSnapshotSchema).min(2).max(6),
  comparisons: z.array(transitionSchema).min(1).max(5),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("pgrb2a_0p50"),
  }),
});

export type GefsRunComparisonQueryInput = z.input<typeof gefsRunComparisonQuerySchema>;
export type GefsRunComparisonQuery = z.output<typeof gefsRunComparisonQuerySchema>;
export type GefsRunComparisonResult = z.infer<typeof gefsRunComparisonResultSchema>;
