import * as z from "zod/v4";
import { GEFS_MEMBERS, isSupportedGefsPressureSelection } from "../catalog/gefs.js";
import {
  gefsMemberSchema,
  gefsPressureVariableSchema,
  gefsRunSelectorSchema,
} from "./gefs-ensemble.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const gefsEnsembleProfileQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native three-hour GEFS cadence"),
  variables: z.array(gefsPressureVariableSchema).min(1).max(5).describe(
    "Raw GEFS pgrb2a pressure-level variables; every selected variable must exist at every selected pressure level",
  ),
  pressureLevelsHpa: z.array(z.number().positive()).min(1).max(12).describe(
    "Published GEFS pressure surfaces in hPa; the Cartesian variable/level selection must be supported",
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
      if (!isSupportedGefsPressureSelection(variable, pressureLevelHpa)) {
        context.addIssue({
          code: "custom",
          path: ["pressureLevelsHpa"],
          message: `GEFS pgrb2a does not publish ${variable} at ${pressureLevelHpa} hPa in the WFG ensemble profile contract`,
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
  variable: gefsPressureVariableSchema,
  gfsCode: z.string().min(1),
  pressureLevelHpa: z.number().positive(),
  outputField: z.string().min(1),
  unit: z.string().min(1),
  memberCount: z.number().int().min(2),
  mean: z.number(),
  populationStdDev: z.number().nonnegative(),
  min: z.number(),
  max: z.number(),
  quantiles: z.array(quantileSchema).min(1),
});

const memberValueSchema = z.object({
  variable: gefsPressureVariableSchema,
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
    variables: z.array(gefsPressureVariableSchema).min(1),
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
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsEnsembleProfileQueryInput = z.input<typeof gefsEnsembleProfileQuerySchema>;
export type GefsEnsembleProfileResult = z.infer<typeof gefsEnsembleProfileResultSchema>;
