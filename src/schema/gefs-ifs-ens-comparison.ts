import * as z from "zod/v4";
import { GEFS_MEMBERS, isSupportedGefsProfileSelection } from "../catalog/gefs.js";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import { gefsMemberSchema } from "./gefs-ensemble.js";
import { ifsEnsMemberSchema } from "./ifs-ens.js";
import { ifsPressureLevelSchema } from "./ifs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const GEFS_IFS_ENS_COMPARISON_VARIABLES = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "vertical_velocity",
  "dew_point",
  "potential_temperature",
  "specific_humidity",
  "mixing_ratio",
  "virtual_temperature",
  "air_density",
  "wet_bulb_temperature",
  "equivalent_potential_temperature",
] as const;

export const gefsIfsEnsComparisonVariableSchema = z.enum(GEFS_IFS_ENS_COMPARISON_VARIABLES);

export const gefsIfsEnsComparisonQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: z.union([z.literal("latest"), isoDateTimeSchema]).default("latest"),
  validTime: isoDateTimeSchema.describe(
    "Forecast valid time supported by both GEFS and ECMWF IFS ENS for one shared initialization cycle",
  ),
  variable: gefsIfsEnsComparisonVariableSchema,
  pressureLevelHpa: ifsPressureLevelSchema,
  gefsMembers: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  ifsEnsMembers: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).default([...IFS_ENS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  thresholdGte: z.number().optional().describe(
    "Optional threshold in normalized output units; each ensemble's raw member fraction is compared independently and is not a calibrated probability",
  ),
}).superRefine((query, context) => {
  if (!isSupportedGefsProfileSelection(query.variable, query.pressureLevelHpa)) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelHpa"],
      message: `GEFS cannot satisfy ${query.variable} at ${query.pressureLevelHpa} hPa in the cross-ensemble comparison contract`,
    });
  }
  if (new Set(query.gefsMembers).size !== query.gefsMembers.length) {
    context.addIssue({ code: "custom", path: ["gefsMembers"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.ifsEnsMembers).size !== query.ifsEnsMembers.length) {
    context.addIssue({ code: "custom", path: ["ifsEnsMembers"], message: "IFS ENS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
});

const numericDistributionSchema = z.object({
  memberCount: z.number().int().min(2),
  mean: z.number(),
  populationStdDev: z.number().nonnegative(),
  min: z.number(),
  max: z.number(),
  quantiles: z.array(z.object({
    quantile: z.number().min(0).max(1),
    value: z.number(),
  })).min(1),
});

export const gefsIfsEnsComparisonResultSchema = z.object({
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  requestedPoint: pointCoordinateSchema,
  selection: z.object({
    variable: gefsIfsEnsComparisonVariableSchema,
    pressureLevelHpa: ifsPressureLevelSchema,
    outputField: z.string().min(1),
    unit: z.string().min(1),
  }),
  gefs: z.object({
    model: z.literal("gefs_0p50"),
    gridPoint: pointCoordinateSchema,
    summary: numericDistributionSchema,
    source: z.object({
      provider: z.literal("NOAA AWS Open Data"),
      access: z.literal("s3_range"),
      decoder: z.enum(["gribberish", "wgrib2"]),
      product: z.literal("pgrb2a_0p50"),
      horizontalGridDegrees: z.literal(0.5),
      allCacheHit: z.boolean(),
    }),
  }),
  ifsEns: z.object({
    model: z.literal("ifs_ens_0p25"),
    gridPoint: pointCoordinateSchema,
    summary: numericDistributionSchema,
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
    ifsEnsMinusGefsMean: z.number(),
    ifsEnsMinusGefsPopulationStdDev: z.number(),
    populationStdDevRatioIfsEnsToGefs: z.number().nonnegative().nullable(),
    quantileShifts: z.array(z.object({
      quantile: z.number().min(0).max(1),
      gefsValue: z.number(),
      ifsEnsValue: z.number(),
      ifsEnsMinusGefs: z.number(),
    })).min(1),
    threshold: z.object({
      operator: z.literal("gte"),
      value: z.number(),
      gefsCount: z.number().int().nonnegative(),
      gefsFraction: z.number().min(0).max(1),
      ifsEnsCount: z.number().int().nonnegative(),
      ifsEnsFraction: z.number().min(0).max(1),
      ifsEnsMinusGefsFraction: z.number().min(-1).max(1),
      interpretation: z.literal("raw_member_fractions_not_calibrated_probabilities"),
    }).optional(),
    interpretation: z.literal(
      "independent_raw_ensemble_distributions_no_member_pairing_not_calibrated_uncertainty",
    ),
  }),
});

export type GefsIfsEnsComparisonVariable = z.infer<typeof gefsIfsEnsComparisonVariableSchema>;
export type GefsIfsEnsComparisonQueryInput = z.input<typeof gefsIfsEnsComparisonQuerySchema>;
export type GefsIfsEnsComparisonResult = z.infer<typeof gefsIfsEnsComparisonResultSchema>;
