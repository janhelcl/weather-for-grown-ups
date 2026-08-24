import * as z from "zod/v4";
import {
  GEFS_MEMBERS,
  GEFS_PROFILE_VARIABLES,
  isSupportedGefsProfileSelection,
} from "../catalog/gefs.js";
import {
  gefsMemberSchema,
  gefsRunSelectorSchema,
} from "./gefs-ensemble.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const gefsProfileVariableSchema = z.enum(GEFS_PROFILE_VARIABLES);

export const gefsEnsembleProfileQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native three-hour GEFS cadence"),
  variables: z.array(gefsProfileVariableSchema).min(1).max(GEFS_PROFILE_VARIABLES.length).describe(
    "GEFS pgrb2a pressure-profile variables. Verified native fields are read directly; moisture thermodynamics unavailable as native pgrb2a messages are derived independently inside each member from temperature, relative humidity and pressure before ensemble aggregation.",
  ),
  pressureLevelsHpa: z.array(z.number().positive()).min(1).max(12).describe(
    "Published GEFS pressure surfaces in hPa; every raw dependency required by the selected variables must exist at every selected level",
  ),
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false).describe(
    "Include each member's full selected profile. False returns distribution summaries only and is recommended for agent context efficiency.",
  ),
}).superRefine((query, context) => {
  if (new Set(query.variables).size !== query.variables.length) {
    context.addIssue({ code: "custom", path: ["variables"], message: "GEFS profile variable selection must not contain duplicates" });
  }
  if (new Set(query.pressureLevelsHpa).size !== query.pressureLevelsHpa.length) {
    context.addIssue({ code: "custom", path: ["pressureLevelsHpa"], message: "GEFS profile pressure-level selection must not contain duplicates" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
  for (const variable of query.variables) {
    for (const pressureLevelHpa of query.pressureLevelsHpa) {
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

const quantileSchema = z.object({
  quantile: z.number().min(0).max(1),
  value: z.number(),
});

const summarySchema = z.object({
  variable: gefsProfileVariableSchema,
  gfsCode: z.string().min(1).optional(),
  dependencies: z.array(z.string().min(1)).min(1).optional(),
  pressureLevelHpa: z.number().positive(),
  outputField: z.string().min(1),
  unit: z.string().min(1),
  memberCount: z.number().int().min(2),
  mean: z.number(),
  populationStdDev: z.number().nonnegative(),
  min: z.number(),
  max: z.number(),
  quantiles: z.array(quantileSchema).min(1),
}).superRefine((summary, context) => {
  if ((summary.gfsCode === undefined) === (summary.dependencies === undefined)) {
    context.addIssue({ code: "custom", message: "GEFS profile summary must identify either one raw GRIB code or derived-variable dependencies" });
  }
});

const memberValueSchema = z.object({
  variable: gefsProfileVariableSchema,
  pressureLevelHpa: z.number().positive(),
  value: z.number(),
});

export const gefsEnsembleProfileResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  selection: z.object({
    variables: z.array(gefsProfileVariableSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
    members: z.array(gefsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  summaries: z.array(summarySchema).min(1),
  members: z.array(z.object({
    member: gefsMemberSchema,
    cacheHit: z.boolean(),
    values: z.array(memberValueSchema).min(1),
  })).min(2).optional(),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsEnsembleProfileQueryInput = z.input<typeof gefsEnsembleProfileQuerySchema>;
export type GefsEnsembleProfileResult = z.infer<typeof gefsEnsembleProfileResultSchema>;
