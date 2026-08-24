import * as z from "zod/v4";
import {
  GEFS_PGRB2A_FIELD_IDS,
  type GefsPgrb2aFieldId,
} from "../catalog/gefs-fields.js";
import {
  GEFS_MEMBERS,
  GEFS_PROFILE_VARIABLES,
  isSupportedGefsProfileSelection,
} from "../catalog/gefs.js";
import { gefsMemberSchema, gefsRunSelectorSchema } from "./gefs-ensemble.js";
import { gefsProfileVariableSchema } from "./gefs-ensemble-profile.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const gefsPgrb2aFieldSchema = z.enum(GEFS_PGRB2A_FIELD_IDS);

export const gefsBundleSelectionSchema = z.object({
  variables: z.array(gefsProfileVariableSchema).max(GEFS_PROFILE_VARIABLES.length).default([]).describe(
    "Pressure-level GEFS variables, including supported member-first derived thermodynamics",
  ),
  pressureLevelsHpa: z.array(z.number().positive()).max(12).default([]).describe(
    "Published pressure levels shared by every selected pressure variable",
  ),
  fields: z.array(gefsPgrb2aFieldSchema).max(GEFS_PGRB2A_FIELD_IDS.length).default([]).describe(
    "GEFS pgrb2a non-isobaric fields such as 2 m temperature, 10 m wind, precipitation, cloud cover, PWAT, CAPE/CIN, or MSLP",
  ),
}).superRefine((selection, context) => {
  const hasVariables = selection.variables.length > 0;
  const hasLevels = selection.pressureLevelsHpa.length > 0;
  if (hasVariables !== hasLevels) {
    context.addIssue({
      code: "custom",
      path: hasVariables ? ["pressureLevelsHpa"] : ["variables"],
      message: "GEFS pressure variables and pressureLevelsHpa must be supplied together",
    });
  }
  if (!hasVariables && selection.fields.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Request at least one pressure-level variable or non-isobaric GEFS field",
    });
  }
  for (const [path, values] of [
    ["variables", selection.variables],
    ["pressureLevelsHpa", selection.pressureLevelsHpa],
    ["fields", selection.fields],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [path], message: `GEFS bundle ${path} must not contain duplicates` });
    }
  }
  for (const variable of selection.variables) {
    for (const pressureLevelHpa of selection.pressureLevelsHpa) {
      if (!isSupportedGefsProfileSelection(variable, pressureLevelHpa)) {
        context.addIssue({
          code: "custom",
          path: ["pressureLevelsHpa"],
          message: `GEFS pgrb2a cannot satisfy ${variable} at ${pressureLevelHpa} hPa because one or more raw dependencies are unavailable`,
        });
      }
    }
  }
});

export const gefsMemberBundleQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native three-hour GEFS cadence"),
  selection: gefsBundleSelectionSchema,
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false).describe(
    "Include every member's selected pressure and field values. Distribution summaries are always returned.",
  ),
}).superRefine((query, context) => {
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
});

export const gefsNumericDistributionSchema = z.object({
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

export const gefsFieldTemporalResultSchema = z.discriminatedUnion("type", [
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

const pressureSummarySchema = z.object({
  variable: gefsProfileVariableSchema,
  pressureLevelHpa: z.number().positive(),
  outputField: z.string().min(1),
  unit: z.string().min(1),
  distribution: gefsNumericDistributionSchema,
});

const numericFieldOutputSummarySchema = z.object({
  aggregation: z.literal("numeric_distribution"),
  field: z.string().min(1),
  unit: z.string().min(1),
  distribution: gefsNumericDistributionSchema,
});

const circularFieldOutputSummarySchema = z.object({
  aggregation: z.literal("circular_direction"),
  field: z.literal("windDirectionDeg"),
  unit: z.literal("degree"),
  memberCount: z.number().int().min(2),
  meanDirectionDeg: z.number().min(0).lt(360),
  resultantLength: z.number().min(0).max(1),
});

export const gefsFieldOutputSummarySchema = z.discriminatedUnion("aggregation", [
  numericFieldOutputSummarySchema,
  circularFieldOutputSummarySchema,
]);

export const gefsFieldSummarySchema = z.object({
  field: gefsPgrb2aFieldSchema,
  level: z.object({ gribLevel: z.string().min(1), description: z.string().min(1) }),
  temporal: gefsFieldTemporalResultSchema,
  outputs: z.array(gefsFieldOutputSummarySchema).min(1),
});

export const gefsMemberBundleResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  selection: z.object({
    variables: z.array(gefsProfileVariableSchema),
    pressureLevelsHpa: z.array(z.number().positive()),
    fields: z.array(gefsPgrb2aFieldSchema),
    members: z.array(gefsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  pressureSummaries: z.array(pressureSummarySchema),
  fieldSummaries: z.array(gefsFieldSummarySchema),
  members: z.array(z.object({
    member: gefsMemberSchema,
    cacheHit: z.boolean(),
    pressureValues: z.array(z.object({
      variable: gefsProfileVariableSchema,
      pressureLevelHpa: z.number().positive(),
      value: z.number(),
    })),
    fields: z.array(z.object({
      field: gefsPgrb2aFieldSchema,
      temporal: gefsFieldTemporalResultSchema,
      values: z.record(z.string(), z.number()),
    })),
  })).min(2).optional(),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsPgrb2aFieldSelectionId = GefsPgrb2aFieldId;
export type GefsBundleSelection = z.output<typeof gefsBundleSelectionSchema>;
export type GefsBundleSelectionInput = z.input<typeof gefsBundleSelectionSchema>;
export type GefsFieldTemporalResult = z.infer<typeof gefsFieldTemporalResultSchema>;
export type GefsMemberBundleQueryInput = z.input<typeof gefsMemberBundleQuerySchema>;
export type GefsMemberBundleResult = z.infer<typeof gefsMemberBundleResultSchema>;
