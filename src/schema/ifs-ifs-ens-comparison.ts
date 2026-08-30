import * as z from "zod/v4";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import { ifsEnsMemberSchema, ifsEnsNumericDistributionSchema } from "./ifs-ens.js";
import { ifsPressureLevelSchema } from "./ifs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const IFS_IFS_ENS_COMPARISON_VARIABLES = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
  "absolute_vorticity",
  "divergence",
  "dew_point",
  "potential_temperature",
  "mixing_ratio",
  "virtual_temperature",
  "air_density",
  "wet_bulb_temperature",
  "equivalent_potential_temperature",
] as const;

export const ifsIfsEnsComparisonVariableSchema =
  z.enum(IFS_IFS_ENS_COMPARISON_VARIABLES);

export const ifsIfsEnsComparisonQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: z.union([z.literal("latest"), isoDateTimeSchema]).default("latest").describe(
    "Shared ECMWF initialization; latest selects the newest cycle for which deterministic IFS and every requested IFS ENS perturbation can satisfy this query",
  ),
  validTime: isoDateTimeSchema.describe(
    "Forecast valid time supported by deterministic IFS and IFS ENS for one shared initialization cycle",
  ),
  variable: ifsIfsEnsComparisonVariableSchema.describe(
    "Scalar pressure-level quantity represented identically by deterministic IFS and IFS ENS",
  ),
  pressureLevelHpa: ifsPressureLevelSchema,
  members: z.array(ifsEnsMemberSchema)
    .min(2)
    .max(IFS_ENS_MEMBERS.length)
    .default([...IFS_ENS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1))
    .min(1)
    .max(9)
    .default([0.1, 0.5, 0.9]),
}).superRefine((query, context) => {
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({
      code: "custom",
      path: ["members"],
      message: "IFS ENS member selection must not contain duplicates",
    });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({
      code: "custom",
      path: ["quantiles"],
      message: "Quantile selection must not contain duplicates",
    });
  }
});

export const ifsIfsEnsComparisonResultSchema = z.object({
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(240),
  requestedPoint: pointCoordinateSchema,
  selection: z.object({
    variable: ifsIfsEnsComparisonVariableSchema,
    pressureLevelHpa: ifsPressureLevelSchema,
    outputField: z.string().min(1),
    unit: z.string().min(1),
  }),
  deterministicIfs: z.object({
    model: z.literal("ifs_0p25"),
    gridPoint: pointCoordinateSchema,
    value: z.number(),
    source: z.object({
      provider: z.literal("ECMWF Open Data"),
      access: z.literal("indexed_http_range"),
      decoder: z.enum(["gribberish", "wgrib2"]),
      product: z.literal("ifs_0p25_oper_fc"),
      horizontalGridDegrees: z.literal(0.25),
      cacheHit: z.boolean(),
    }),
  }),
  ifsEns: z.object({
    model: z.literal("ifs_ens_0p25"),
    gridPoint: pointCoordinateSchema,
    members: z.array(z.object({
      member: ifsEnsMemberSchema,
      value: z.number(),
      cacheHit: z.boolean(),
    })).min(2),
    summary: ifsEnsNumericDistributionSchema,
    source: z.object({
      provider: z.literal("ECMWF Open Data"),
      access: z.literal("indexed_http_range"),
      decoder: z.enum(["gribberish", "wgrib2"]),
      product: z.literal("ifs_0p25_enfo_ef"),
      horizontalGridDegrees: z.literal(0.25),
      allCacheHit: z.boolean(),
      memberSemantics: z.literal("50_perturbed_members_control_is_oper_fc"),
    }),
  }),
  comparison: z.object({
    deterministicMinusEnsembleMean: z.number(),
    standardizedDifference: z.number().nullable().describe(
      "(deterministic IFS - IFS ENS perturbed-member mean) / IFS ENS population standard deviation; null for zero spread",
    ),
    membersBelowDeterministic: z.number().int().nonnegative(),
    membersAtOrBelowDeterministic: z.number().int().nonnegative(),
    fractionMembersBelowDeterministic: z.number().min(0).max(1),
    fractionMembersAtOrBelowDeterministic: z.number().min(0).max(1),
    rangePosition: z.enum(["below_member_min", "within_member_range", "above_member_max"]),
    outsideMemberRange: z.boolean(),
    interpretation: z.literal(
      "deterministic_ifs_control_vs_perturbed_ensemble_distribution_not_calibrated_uncertainty",
    ),
  }),
});

export type IfsIfsEnsComparisonVariable =
  z.infer<typeof ifsIfsEnsComparisonVariableSchema>;
export type IfsIfsEnsComparisonQueryInput =
  z.input<typeof ifsIfsEnsComparisonQuerySchema>;
export type IfsIfsEnsComparisonResult =
  z.infer<typeof ifsIfsEnsComparisonResultSchema>;
