import * as z from "zod/v4";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import {
  ifsLayerDiagnosticsQuerySchema,
  ifsParcelDiagnosticsQuerySchema,
  ifsProfileDiagnosticsQuerySchema,
} from "./ifs-diagnostics.js";
import { ifsEnsMemberSchema } from "./ifs-ens.js";
import { ifsPressureLevelSchema, ifsRunSelectorSchema } from "./ifs.js";
import {
  isoDateTimeSchema,
  layerDiagnosticIdSchema,
  parcelDefinitionIdSchema,
  pointCoordinateSchema,
  profileDiagnosticIdSchema,
} from "./query.js";
import {
  layerDiagnosticResultSchema,
  parcelComputationSchema,
  profileDiagnosticResultSchema,
  profileLevelResultSchema,
} from "./result.js";

const quantilesSchema = z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]);
const membersSchema = z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).default([...IFS_ENS_MEMBERS]);

function validateEnsembleSelection(
  query: { members: readonly string[]; quantiles: readonly number[] },
  context: z.RefinementCtx,
): void {
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "IFS ENS members must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantiles must not contain duplicates" });
  }
}

function relayDeterministicIssues(
  parsed: { success: true } | { success: false; error: z.ZodError },
  context: z.RefinementCtx,
): void {
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    context.addIssue({
      code: "custom",
      path: issue.path,
      message: issue.message,
    });
  }
}

export const ifsEnsLayerDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native ECMWF ENS cadence"),
  lowerPressureHpa: ifsPressureLevelSchema,
  upperPressureHpa: ifsPressureLevelSchema,
  diagnostics: z.array(layerDiagnosticIdSchema).min(1),
  members: membersSchema,
  quantiles: quantilesSchema,
  includeMembers: z.boolean().default(false).describe(
    "Include each perturbation's derived layer and diagnostic values. Distribution summaries are always returned.",
  ),
}).superRefine((query, context) => {
  validateEnsembleSelection(query, context);
  relayDeterministicIssues(ifsLayerDiagnosticsQuerySchema.safeParse({
    latitude: query.latitude,
    longitude: query.longitude,
    run: query.run,
    validTime: query.validTime,
    lowerPressureHpa: query.lowerPressureHpa,
    upperPressureHpa: query.upperPressureHpa,
    diagnostics: query.diagnostics,
  }), context);
});

export const ifsEnsProfileDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native ECMWF ENS cadence"),
  pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2).max(14),
  diagnostics: z.array(profileDiagnosticIdSchema).min(1),
  members: membersSchema,
  quantiles: quantilesSchema,
  includeMembers: z.boolean().default(false).describe(
    "Include each perturbation's sampled profile and complete derived structures. Structural summaries are always returned.",
  ),
}).superRefine((query, context) => {
  validateEnsembleSelection(query, context);
  relayDeterministicIssues(ifsProfileDiagnosticsQuerySchema.safeParse({
    latitude: query.latitude,
    longitude: query.longitude,
    run: query.run,
    validTime: query.validTime,
    pressureLevelsHpa: query.pressureLevelsHpa,
    diagnostics: query.diagnostics,
  }), context);
});

export const ifsEnsParcelDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native ECMWF ENS cadence"),
  pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2).max(14),
  parcel: parcelDefinitionIdSchema,
  members: membersSchema,
  quantiles: quantilesSchema,
  includeMembers: z.boolean().default(false).describe(
    "Include each perturbation's sampled environment and complete parcel path. Compact parcel summaries are always returned.",
  ),
}).superRefine((query, context) => {
  validateEnsembleSelection(query, context);
  relayDeterministicIssues(ifsParcelDiagnosticsQuerySchema.safeParse({
    latitude: query.latitude,
    longitude: query.longitude,
    run: query.run,
    validTime: query.validTime,
    pressureLevelsHpa: query.pressureLevelsHpa,
    parcel: query.parcel,
  }), context);
});

const quantileSchema = z.object({ quantile: z.number().min(0).max(1), value: z.number() });
const numericDistributionSchema = z.object({
  memberCount: z.number().int().positive(),
  mean: z.number(),
  populationStdDev: z.number().nonnegative(),
  min: z.number(),
  max: z.number(),
  quantiles: z.array(quantileSchema).min(1),
});
const fullMemberDistributionSchema = numericDistributionSchema.extend({
  memberCount: z.number().int().min(2),
});
const rawMemberEventFractionSchema = z.object({
  count: z.number().int().nonnegative(),
  memberCount: z.number().int().min(2),
  fraction: z.number().min(0).max(1),
  interpretation: z.literal("raw_member_fraction_not_calibrated_probability"),
});

const sourceSchema = z.object({
  provider: z.literal("ECMWF Open Data"),
  access: z.literal("indexed_http_range"),
  decoder: z.enum(["gribberish", "wgrib2"]),
  product: z.literal("ifs_0p25_enfo_ef"),
  horizontalGridDegrees: z.literal(0.25),
  allCacheHit: z.boolean(),
  memberSemantics: z.literal("50_perturbed_members_control_is_oper_fc"),
});

export const ifsEnsLayerDiagnosticsResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  pressureLayer: z.object({
    lowerPressureHpa: ifsPressureLevelSchema,
    upperPressureHpa: ifsPressureLevelSchema,
  }),
  selection: z.object({
    diagnostics: z.array(layerDiagnosticIdSchema).min(1),
    members: z.array(ifsEnsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  layerDepthGpm: fullMemberDistributionSchema,
  summaries: z.array(z.object({
    id: layerDiagnosticIdSchema,
    field: z.string().min(1),
    unit: z.string().min(1),
    distribution: fullMemberDistributionSchema,
  })).min(1),
  members: z.array(z.object({
    member: ifsEnsMemberSchema,
    cacheHit: z.boolean(),
    layer: z.object({
      lowerPressureHpa: z.number().positive(),
      upperPressureHpa: z.number().positive(),
      lowerGeopotentialHeightGpm: z.number(),
      upperGeopotentialHeightGpm: z.number(),
      depthGpm: z.number().positive(),
    }),
    diagnostics: z.array(layerDiagnosticResultSchema).min(1),
  })).min(2).optional(),
  source: sourceSchema,
});

const conditionalCrossingDistributionSchema = z.object({
  contributingMemberCount: z.number().int().positive(),
  geopotentialHeightGpm: numericDistributionSchema,
  pressureHpa: numericDistributionSchema,
});
const freezingLevelSummarySchema = z.object({
  id: z.literal("freezing_level_crossings"),
  membersWithAnyCrossing: rawMemberEventFractionSchema,
  crossingCount: fullMemberDistributionSchema,
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
  layerCount: fullMemberDistributionSchema,
  totalLayerDepthGpm: fullMemberDistributionSchema,
  deepestLayerDepthGpm: conditionalInversionDistributionSchema.optional(),
  strongestTemperatureIncreaseC: conditionalInversionDistributionSchema.optional(),
  strongestMeanTemperatureGradientCPerKm: conditionalInversionDistributionSchema.optional(),
});
export const ifsEnsProfileDiagnosticSummarySchema = z.discriminatedUnion("id", [
  freezingLevelSummarySchema,
  inversionSummarySchema,
]);

export const ifsEnsProfileDiagnosticsResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  sampledPressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2),
  selection: z.object({
    diagnostics: z.array(profileDiagnosticIdSchema).min(1),
    members: z.array(ifsEnsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  summaries: z.array(ifsEnsProfileDiagnosticSummarySchema).min(1),
  members: z.array(z.object({
    member: ifsEnsMemberSchema,
    cacheHit: z.boolean(),
    levels: z.array(profileLevelResultSchema).min(2),
    diagnostics: z.array(profileDiagnosticResultSchema).min(1),
  })).min(2).optional(),
  source: sourceSchema,
});

const boundarySummarySchema = z.object({
  membersWithBoundary: rawMemberEventFractionSchema,
  pressureHpa: numericDistributionSchema.optional(),
  geopotentialHeightGpm: numericDistributionSchema.optional(),
});

export const ifsEnsParcelDiagnosticsResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  sampledPressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2),
  selection: z.object({
    parcel: parcelDefinitionIdSchema,
    members: z.array(ifsEnsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  methodology: z.object({
    pressureMoisture: z.literal("ifs_specific_humidity_direct_per_member"),
    surfaceMoisture: z.literal("2m_temperature_dew_point_surface_pressure_to_specific_humidity_per_member"),
    surfaceOrography: z.literal("same_cycle_f000_surface_geopotential_height"),
  }),
  summary: z.object({
    startingPressureHpa: fullMemberDistributionSchema,
    startingTemperatureC: fullMemberDistributionSchema,
    startingSpecificHumidityKgKg: fullMemberDistributionSchema,
    lclPressureHpa: fullMemberDistributionSchema,
    lclTemperatureC: fullMemberDistributionSchema,
    capeJkg: fullMemberDistributionSchema,
    cinJkg: fullMemberDistributionSchema,
    membersWithPositiveCape: rawMemberEventFractionSchema,
    lfc: boundarySummarySchema,
    el: boundarySummarySchema,
  }),
  members: z.array(z.object({
    member: ifsEnsMemberSchema,
    cacheHit: z.boolean(),
    levels: z.array(profileLevelResultSchema).min(2),
    parcel: parcelComputationSchema,
  })).min(2).optional(),
  source: sourceSchema,
});

export type IfsEnsLayerDiagnosticsQueryInput = z.input<typeof ifsEnsLayerDiagnosticsQuerySchema>;
export type IfsEnsLayerDiagnosticsResult = z.infer<typeof ifsEnsLayerDiagnosticsResultSchema>;
export type IfsEnsProfileDiagnosticsQueryInput = z.input<typeof ifsEnsProfileDiagnosticsQuerySchema>;
export type IfsEnsProfileDiagnosticsResult = z.infer<typeof ifsEnsProfileDiagnosticsResultSchema>;
export type IfsEnsParcelDiagnosticsQueryInput = z.input<typeof ifsEnsParcelDiagnosticsQuerySchema>;
export type IfsEnsParcelDiagnosticsResult = z.infer<typeof ifsEnsParcelDiagnosticsResultSchema>;
