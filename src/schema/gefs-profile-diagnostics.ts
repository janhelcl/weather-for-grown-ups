import * as z from "zod/v4";
import {
  GEFS_MEMBERS,
  GEFS_PGRB2A_PRESSURE_VARIABLES,
  isSupportedGefsPressureSelection,
  type GefsPressureVariableId,
} from "../catalog/gefs.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import { gefsMemberSchema, gefsRunSelectorSchema } from "./gefs-ensemble.js";
import {
  isoDateTimeSchema,
  pointCoordinateSchema,
  profileDiagnosticIdSchema,
} from "./query.js";
import { profileDiagnosticResultSchema, profileLevelResultSchema } from "./result.js";

export const gefsProfileDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native three-hour GEFS cadence"),
  pressureLevelsHpa: z.array(z.number().positive()).min(2).max(12),
  diagnostics: z.array(profileDiagnosticIdSchema).min(1),
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false).describe(
    "Include each member's sampled profile and complete derived structures. Ensemble structural summaries are always returned.",
  ),
}).superRefine((query, context) => {
  if (new Set(query.pressureLevelsHpa).size !== query.pressureLevelsHpa.length) {
    context.addIssue({ code: "custom", path: ["pressureLevelsHpa"], message: "GEFS profile diagnostic pressure levels must not contain duplicates" });
  }
  if (new Set(query.diagnostics).size !== query.diagnostics.length) {
    context.addIssue({ code: "custom", path: ["diagnostics"], message: "GEFS profile diagnostic selection must not contain duplicates" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }

  const supportedVariables = new Set<string>(GEFS_PGRB2A_PRESSURE_VARIABLES);
  const variables = expandProfileDiagnosticVariables(query.diagnostics);
  for (const variable of variables) {
    if (!supportedVariables.has(variable)) {
      context.addIssue({
        code: "custom",
        path: ["diagnostics"],
        message: `GEFS pgrb2a does not support required profile-diagnostic variable ${variable}`,
      });
      continue;
    }
    for (const pressureLevelHpa of query.pressureLevelsHpa) {
      if (!isSupportedGefsPressureSelection(variable as GefsPressureVariableId, pressureLevelHpa)) {
        context.addIssue({
          code: "custom",
          path: ["pressureLevelsHpa"],
          message: `GEFS pgrb2a does not publish required ${variable} at ${pressureLevelHpa} hPa for this diagnostic selection`,
        });
      }
    }
  }
});

const quantileSchema = z.object({
  quantile: z.number().min(0).max(1),
  value: z.number(),
});

const numericDistributionSchema = z.object({
  memberCount: z.number().int().positive(),
  mean: z.number(),
  populationStdDev: z.number().nonnegative(),
  min: z.number(),
  max: z.number(),
  quantiles: z.array(quantileSchema).min(1),
});

const rawMemberEventFractionSchema = z.object({
  count: z.number().int().nonnegative(),
  memberCount: z.number().int().min(2),
  fraction: z.number().min(0).max(1),
  interpretation: z.literal("raw_member_fraction_not_calibrated_probability"),
});

const conditionalCrossingDistributionSchema = z.object({
  contributingMemberCount: z.number().int().positive(),
  geopotentialHeightGpm: numericDistributionSchema,
  pressureHpa: numericDistributionSchema,
});

const freezingLevelSummarySchema = z.object({
  id: z.literal("freezing_level_crossings"),
  membersWithAnyCrossing: rawMemberEventFractionSchema,
  crossingCount: numericDistributionSchema,
  lowestCrossing: conditionalCrossingDistributionSchema.optional(),
  highestCrossing: conditionalCrossingDistributionSchema.optional(),
});

const conditionalInversionDistributionSchema = z.object({
  contributingMemberCount: z.number().int().positive(),
  distribution: numericDistributionSchema,
});

const inversionSummarySchema = z.object({
  id: z.literal("temperature_inversion_layers"),
  membersWithAnyLayer: rawMemberEventFractionSchema,
  layerCount: numericDistributionSchema,
  totalLayerDepthGpm: numericDistributionSchema,
  deepestLayerDepthGpm: conditionalInversionDistributionSchema.optional(),
  strongestTemperatureIncreaseC: conditionalInversionDistributionSchema.optional(),
  strongestMeanTemperatureGradientCPerKm: conditionalInversionDistributionSchema.optional(),
});

export const gefsProfileDiagnosticSummarySchema = z.discriminatedUnion("id", [
  freezingLevelSummarySchema,
  inversionSummarySchema,
]);

export const gefsProfileDiagnosticsResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  sampledPressureLevelsHpa: z.array(z.number().positive()).min(2),
  selection: z.object({
    diagnostics: z.array(profileDiagnosticIdSchema).min(1),
    members: z.array(gefsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  summaries: z.array(gefsProfileDiagnosticSummarySchema).min(1),
  members: z.array(z.object({
    member: gefsMemberSchema,
    cacheHit: z.boolean(),
    levels: z.array(profileLevelResultSchema).min(2),
    diagnostics: z.array(profileDiagnosticResultSchema).min(1),
  })).min(2).optional(),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsProfileDiagnosticsQueryInput = z.input<typeof gefsProfileDiagnosticsQuerySchema>;
export type GefsProfileDiagnosticsResult = z.infer<typeof gefsProfileDiagnosticsResultSchema>;
