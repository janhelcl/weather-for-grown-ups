import * as z from "zod/v4";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import { ifsEnsMemberSchema, ifsEnsNumericDistributionSchema } from "./ifs-ens.js";
import {
  ifsPressureLevelSchema,
  ifsPressureVariableSchema,
  ifsRunSelectorSchema,
} from "./ifs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const ifsEnsRunComparisonQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  anchorRun: ifsRunSelectorSchema.describe(
    "Newest ECMWF ENS cycle in the comparison; latest is selection-aware for valid time and perturbations",
  ),
  validTime: isoDateTimeSchema,
  variable: ifsPressureVariableSchema,
  pressureLevelHpa: ifsPressureLevelSchema,
  members: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).default([...IFS_ENS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  thresholdGte: z.number().optional(),
  cycles: z.number().int().min(2).max(6).default(3),
  cycleStrideHours: z.union([z.literal(6), z.literal(12)]).default(6).describe(
    "6 compares consecutive ENS cycles; 12 compares same-class 00/12 or 06/18 cycles and is useful beyond short-cycle horizons",
  ),
}).superRefine((query, context) => {
  const outputs = VARIABLE_CATALOG[query.variable].outputs;
  if (outputs.length !== 1 || outputs[0]?.field === "windDirectionDeg") {
    context.addIssue({
      code: "custom",
      path: ["variable"],
      message: "IFS ENS run comparison currently requires a pressure variable with one numeric scalar output; use u_wind/v_wind or another scalar instead of wind",
    });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "IFS ENS members must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantiles must not contain duplicates" });
  }
});

const thresholdSummarySchema = z.object({
  operator: z.literal("gte"),
  value: z.number(),
  count: z.number().int().nonnegative(),
  fraction: z.number().min(0).max(1),
  interpretation: z.literal("raw_member_fraction_not_calibrated_probability"),
});

const runSnapshotSchema = z.object({
  run: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  summary: ifsEnsNumericDistributionSchema.extend({
    threshold: thresholdSummarySchema.optional(),
  }),
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
  fromForecastHour: z.number().int().min(0).max(360),
  toForecastHour: z.number().int().min(0).max(360),
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

export const ifsEnsRunComparisonResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  validTime: isoDateTimeSchema,
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  anchorRun: isoDateTimeSchema,
  cycleStrideHours: z.union([z.literal(6), z.literal(12)]),
  selection: z.object({
    variable: ifsPressureVariableSchema,
    pressureLevelHpa: ifsPressureLevelSchema,
    outputField: z.string().min(1),
    unit: z.string().min(1),
    members: z.array(ifsEnsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
    thresholdGte: z.number().optional(),
  }),
  runs: z.array(runSnapshotSchema).min(2).max(6),
  comparisons: z.array(transitionSchema).min(1).max(5),
  source: z.object({
    provider: z.literal("ECMWF Open Data"),
    access: z.literal("indexed_http_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("ifs_0p25_enfo_ef"),
    horizontalGridDegrees: z.literal(0.25),
    memberSemantics: z.literal("50_perturbed_members_control_is_oper_fc"),
  }),
});

export type IfsEnsRunComparisonQueryInput = z.input<typeof ifsEnsRunComparisonQuerySchema>;
export type IfsEnsRunComparisonResult = z.infer<typeof ifsEnsRunComparisonResultSchema>;
