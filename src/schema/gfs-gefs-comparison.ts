import * as z from "zod/v4";
import { GEFS_MEMBERS, isSupportedGefsPressureSelection } from "../catalog/gefs.js";
import { gefsMemberSchema, gefsPressureVariableSchema } from "./gefs-ensemble.js";
import { gfsGridSchema, operationalGfsModelIdSchema } from "./gfs-grid.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const gfsGefsComparisonRunSelectorSchema = z.union([
  z.literal("latest"),
  isoDateTimeSchema,
]).default("latest").describe(
  "Shared GFS/GEFS initialization time; 'latest' selects the newest cycle for which both deterministic GFS and every requested GEFS member can satisfy this query",
);

export const gfsGefsComparisonQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  gfsGrid: gfsGridSchema.optional(),
  run: gfsGefsComparisonRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native three-hour GEFS cadence"),
  variable: gefsPressureVariableSchema.describe("Raw pressure-level variable supported by both deterministic GFS and GEFS pgrb2a"),
  pressureLevelHpa: z.number().positive(),
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
}).superRefine((query, context) => {
  if (!isSupportedGefsPressureSelection(query.variable, query.pressureLevelHpa)) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelHpa"],
      message: `GEFS pgrb2a does not publish ${query.variable} at ${query.pressureLevelHpa} hPa in the WFG comparison contract`,
    });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
});

const comparisonSelectionSchema = z.object({
  variable: gefsPressureVariableSchema,
  gfsCode: z.string().min(1),
  pressureLevelHpa: z.number().positive(),
  outputField: z.string().min(1),
  unit: z.string().min(1),
});

export const gfsGefsComparisonResultSchema = z.object({
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  requestedPoint: pointCoordinateSchema,
  selection: comparisonSelectionSchema,
  deterministicGfs: z.object({
    model: operationalGfsModelIdSchema,
    gridPoint: pointCoordinateSchema,
    value: z.number(),
    source: z.object({
      provider: z.string().min(1),
      access: z.string().min(1),
      decoder: z.enum(["gribberish", "wgrib2"]),
      cacheHit: z.boolean(),
    }),
  }),
  gefs: z.object({
    model: z.literal("gefs_0p50"),
    gridPoint: pointCoordinateSchema,
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
    }),
    source: z.object({
      provider: z.literal("NOAA AWS Open Data"),
      access: z.literal("s3_range"),
      decoder: z.enum(["gribberish", "wgrib2"]),
      product: z.literal("pgrb2a_0p50"),
      allCacheHit: z.boolean(),
    }),
  }),
  comparison: z.object({
    deterministicMinusEnsembleMean: z.number(),
    standardizedDifference: z.number().nullable().describe(
      "(deterministic GFS - GEFS member mean) / GEFS population standard deviation; null when requested members have zero spread",
    ),
    membersBelowDeterministic: z.number().int().nonnegative(),
    membersAtOrBelowDeterministic: z.number().int().nonnegative(),
    fractionMembersBelowDeterministic: z.number().min(0).max(1),
    fractionMembersAtOrBelowDeterministic: z.number().min(0).max(1),
    rangePosition: z.enum(["below_member_min", "within_member_range", "above_member_max"]),
    outsideMemberRange: z.boolean(),
    interpretation: z.literal("raw_model_vs_raw_ensemble_distribution_not_calibrated_uncertainty"),
  }),
});

export type GfsGefsComparisonQueryInput = z.input<typeof gfsGefsComparisonQuerySchema>;
export type GfsGefsComparisonResult = z.infer<typeof gfsGefsComparisonResultSchema>;
