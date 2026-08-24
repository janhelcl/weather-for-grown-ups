import * as z from "zod/v4";
import { GEFS_PGRB2A_RAW_FIELD_IDS } from "../catalog/gefs-fields.js";
import {
  GEFS_MEMBERS,
  GEFS_PGRB2A_PRESSURE_VARIABLES,
  isSupportedGefsPressureSelection,
} from "../catalog/gefs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const gefsMemberSchema = z.enum(GEFS_MEMBERS);
export const gefsPressureVariableSchema = z.enum(GEFS_PGRB2A_PRESSURE_VARIABLES);
export const gefsRawFieldSchema = z.enum(GEFS_PGRB2A_RAW_FIELD_IDS);

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
  variable: gefsPressureVariableSchema.optional().describe("One raw GEFS pgrb2a pressure-level variable; supply with pressureLevelHpa and without field"),
  pressureLevelHpa: z.number().positive().optional().describe("Pressure surface in hPa; supply with variable and without field"),
  field: gefsRawFieldSchema.optional().describe("One raw GEFS pgrb2a non-isobaric field; mutually exclusive with variable/pressureLevelHpa"),
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  thresholdGte: z.number().optional().describe(
    "Optional threshold in normalized output units; the returned fraction is the raw share of requested members meeting or exceeding it, not a calibrated probability",
  ),
}).superRefine((query, context) => {
  const hasField = query.field !== undefined;
  const hasVariable = query.variable !== undefined;
  const hasLevel = query.pressureLevelHpa !== undefined;
  if (hasField) {
    if (hasVariable || hasLevel) {
      context.addIssue({ code: "custom", path: ["field"], message: "GEFS ensemble accepts either field or variable+pressureLevelHpa, not both" });
    }
  } else {
    if (!hasVariable || !hasLevel) {
      context.addIssue({ code: "custom", path: [hasVariable ? "pressureLevelHpa" : "variable"], message: "GEFS pressure ensemble requires variable and pressureLevelHpa together" });
    } else if (!isSupportedGefsPressureSelection(query.variable!, query.pressureLevelHpa!)) {
      context.addIssue({
        code: "custom",
        path: ["pressureLevelHpa"],
        message: `GEFS pgrb2a does not publish ${query.variable} at ${query.pressureLevelHpa} hPa in the WFG ensemble contract`,
      });
    }
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
});

const temporalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("instantaneous") }),
  z.object({
    type: z.literal("accumulation"),
    startForecastHour: z.number().nonnegative(),
    endForecastHour: z.number().nonnegative(),
    startTime: isoDateTimeSchema,
    endTime: isoDateTimeSchema,
  }),
  z.object({
    type: z.literal("average"),
    startForecastHour: z.number().nonnegative(),
    endForecastHour: z.number().nonnegative(),
    startTime: isoDateTimeSchema,
    endTime: isoDateTimeSchema,
  }),
]);

const selectionSchema = z.object({
  // Keep the established pressure-selection serialization order stable for MCP/text clients.
  variable: gefsPressureVariableSchema.optional(),
  gfsCode: z.string().min(1),
  pressureLevelHpa: z.number().positive().optional(),
  field: gefsRawFieldSchema.optional(),
  outputField: z.string().min(1),
  unit: z.string().min(1),
  vertical: z.object({
    gribLevel: z.string().min(1),
    description: z.string().min(1),
  }).optional(),
  temporal: temporalSchema.optional(),
}).superRefine((selection, context) => {
  if (selection.field !== undefined) {
    if (selection.variable !== undefined || selection.pressureLevelHpa !== undefined || !selection.vertical || !selection.temporal) {
      context.addIssue({ code: "custom", message: "GEFS field selection requires field/vertical/temporal metadata only" });
    }
  } else if (selection.variable === undefined || selection.pressureLevelHpa === undefined) {
    context.addIssue({ code: "custom", message: "GEFS pressure selection requires variable and pressureLevelHpa" });
  }
});

export const gefsEnsembleResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  selection: selectionSchema,
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
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsEnsembleQuery = z.output<typeof gefsEnsembleQuerySchema>;
export type GefsEnsembleQueryInput = z.input<typeof gefsEnsembleQuerySchema>;
export type GefsEnsembleResult = z.infer<typeof gefsEnsembleResultSchema>;
