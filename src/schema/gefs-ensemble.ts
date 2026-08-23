import * as z from "zod/v4";
import {
  GEFS_MEMBERS,
  GEFS_PGRB2A_PRESSURE_VARIABLES,
  isSupportedGefsPressureSelection,
} from "../catalog/gefs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const gefsMemberSchema = z.enum(GEFS_MEMBERS);
export const gefsPressureVariableSchema = z.enum(GEFS_PGRB2A_PRESSURE_VARIABLES);

export const gefsRunSelectorSchema = z.union([
  z.literal("latest"),
  isoDateTimeSchema,
]).default("latest").describe(
  "GEFS initialization time; 'latest' selects the newest cycle whose requested members are available at the requested valid time",
);

export const gefsEnsembleQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native three-hour GEFS cadence"),
  variable: gefsPressureVariableSchema.describe("One raw GEFS pgrb2a pressure-level variable"),
  pressureLevelHpa: z.number().positive().describe("Pressure surface in hPa; support depends on the selected pgrb2a variable"),
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  thresholdGte: z.number().optional().describe(
    "Optional threshold in normalized output units; the returned fraction is the raw share of requested members meeting or exceeding it, not a calibrated probability",
  ),
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

export const gefsEnsembleResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  selection: z.object({
    variable: gefsPressureVariableSchema,
    gfsCode: z.string().min(1),
    pressureLevelHpa: z.number().positive(),
    outputField: z.string().min(1),
    unit: z.string().min(1),
  }),
  members: z.array(z.object({
    member: gefsMemberSchema,
    value: z.number(),
    cacheHit: z.boolean(),
  })).min(2),
  summary: z.object({
    memberCount: z.number().int().min(2),
    mean: z.number(),
    populationStdDev: z.number().nonnegative(),
    min: z.number(),
    max: z.number(),
    quantiles: z.array(z.object({
      quantile: z.number().min(0).max(1),
      value: z.number(),
    })).min(1),
    threshold: z.object({
      operator: z.literal("gte"),
      value: z.number(),
      count: z.number().int().nonnegative(),
      fraction: z.number().min(0).max(1),
      interpretation: z.literal("raw_member_fraction_not_calibrated_probability"),
    }).optional(),
  }),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsEnsembleQuery = z.output<typeof gefsEnsembleQuerySchema>;
export type GefsEnsembleQueryInput = z.input<typeof gefsEnsembleQuerySchema>;
export type GefsEnsembleResult = z.infer<typeof gefsEnsembleResultSchema>;
