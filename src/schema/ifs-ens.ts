import * as z from "zod/v4";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import { ifsFieldSchema, ifsPressureLevelSchema, ifsPressureVariableSchema, ifsRunSelectorSchema } from "./ifs.js";
import {
  fieldTemporalResultSchema,
  nonIsobaricFieldLevelResultSchema,
} from "./result.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const ifsEnsMemberSchema = z.enum(IFS_ENS_MEMBERS);

export const ifsEnsSelectionSchema = z.object({
  variables: z.array(ifsPressureVariableSchema).default([]),
  pressureLevelsHpa: z.array(ifsPressureLevelSchema).default([]),
  fields: z.array(ifsFieldSchema).default([]),
}).superRefine((selection, context) => {
  const hasVariables = selection.variables.length > 0;
  const hasLevels = selection.pressureLevelsHpa.length > 0;
  if (hasVariables !== hasLevels) {
    context.addIssue({
      code: "custom",
      path: hasVariables ? ["pressureLevelsHpa"] : ["variables"],
      message: "IFS ENS pressure variables and pressureLevelsHpa must be supplied together",
    });
  }
  if (!hasVariables && selection.fields.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Request at least one IFS ENS pressure variable or field",
    });
  }
  if (new Set(selection.variables).size !== selection.variables.length) {
    context.addIssue({ code: "custom", path: ["variables"], message: "IFS ENS variables must not contain duplicates" });
  }
  if (new Set(selection.pressureLevelsHpa).size !== selection.pressureLevelsHpa.length) {
    context.addIssue({ code: "custom", path: ["pressureLevelsHpa"], message: "IFS ENS pressureLevelsHpa must not contain duplicates" });
  }
  if (new Set(selection.fields).size !== selection.fields.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "IFS ENS fields must not contain duplicates" });
  }
});

export const ifsEnsMemberBundleQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on native ECMWF ENS cadence"),
  selection: ifsEnsSelectionSchema,
  members: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).default([...IFS_ENS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false).describe(
    "Include each perturbation's selected normalized values. Distribution summaries are always returned.",
  ),
}).superRefine((query, context) => {
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "IFS ENS members must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantiles must not contain duplicates" });
  }
});

export const ifsEnsNumericDistributionSchema = z.object({
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

const numericOutputSummarySchema = z.object({
  aggregation: z.literal("numeric_distribution"),
  field: z.string().min(1),
  unit: z.string().min(1),
  distribution: ifsEnsNumericDistributionSchema,
});

const circularOutputSummarySchema = z.object({
  aggregation: z.literal("circular_direction"),
  field: z.literal("windDirectionDeg"),
  unit: z.literal("degree"),
  memberCount: z.number().int().min(2),
  meanDirectionDeg: z.number().min(0).lt(360),
  resultantLength: z.number().min(0).max(1),
});

export const ifsEnsOutputSummarySchema = z.discriminatedUnion("aggregation", [
  numericOutputSummarySchema,
  circularOutputSummarySchema,
]);

const pressureSummarySchema = z.object({
  variable: ifsPressureVariableSchema,
  pressureLevelHpa: ifsPressureLevelSchema,
  outputs: z.array(ifsEnsOutputSummarySchema).min(1),
});

const fieldSummarySchema = z.object({
  field: ifsFieldSchema,
  level: nonIsobaricFieldLevelResultSchema,
  temporal: fieldTemporalResultSchema,
  outputs: z.array(ifsEnsOutputSummarySchema).min(1),
});

const memberPressureValueSchema = z.object({
  variable: ifsPressureVariableSchema,
  pressureLevelHpa: ifsPressureLevelSchema,
  values: z.record(z.string(), z.number()),
});

const memberFieldValueSchema = z.object({
  field: ifsFieldSchema,
  temporal: fieldTemporalResultSchema,
  values: z.record(z.string(), z.number()),
});

export const ifsEnsMemberBundleResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  selection: z.object({
    variables: z.array(ifsPressureVariableSchema),
    pressureLevelsHpa: z.array(ifsPressureLevelSchema),
    fields: z.array(ifsFieldSchema),
    members: z.array(ifsEnsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  pressureSummaries: z.array(pressureSummarySchema),
  fieldSummaries: z.array(fieldSummarySchema),
  members: z.array(z.object({
    member: ifsEnsMemberSchema,
    cacheHit: z.boolean(),
    pressureValues: z.array(memberPressureValueSchema),
    fields: z.array(memberFieldValueSchema),
  })).min(2).optional(),
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

export type IfsEnsSelection = z.output<typeof ifsEnsSelectionSchema>;
export type IfsEnsMemberBundleQueryInput = z.input<typeof ifsEnsMemberBundleQuerySchema>;
export type IfsEnsMemberBundleResult = z.infer<typeof ifsEnsMemberBundleResultSchema>;
