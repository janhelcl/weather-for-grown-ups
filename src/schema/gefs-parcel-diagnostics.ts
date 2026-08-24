import * as z from "zod/v4";
import {
  GEFS_MEMBERS,
  GEFS_PGRB2A_COMMON_PRESSURE_LEVELS_HPA,
} from "../catalog/gefs.js";
import { gefsMemberSchema, gefsRunSelectorSchema } from "./gefs-ensemble.js";
import {
  isoDateTimeSchema,
  parcelDefinitionIdSchema,
  pointCoordinateSchema,
} from "./query.js";
import {
  parcelComputationSchema,
  profileLevelResultSchema,
} from "./result.js";

const supportedPressureLevels = new Set<number>(GEFS_PGRB2A_COMMON_PRESSURE_LEVELS_HPA);
const gefsParcelPressureLevelSchema = z.number().positive().refine(
  (value) => supportedPressureLevels.has(value),
  "GEFS pgrb2a parcel diagnostics require a pressure level where temperature, relative humidity and geopotential height are all published",
);

export const gefsParcelDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native three-hour GEFS cadence"),
  pressureLevelsHpa: z.array(gefsParcelPressureLevelSchema).min(2).max(GEFS_PGRB2A_COMMON_PRESSURE_LEVELS_HPA.length).describe(
    "Explicit GEFS pressure surfaces forming each member's environmental sounding. Vertical resolution controls parcel integration resolution.",
  ),
  parcel: parcelDefinitionIdSchema,
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false).describe(
    "Include each member's derived environmental profile and complete parcel path. Compact structural/distribution summaries are always returned.",
  ),
}).superRefine((query, context) => {
  if (new Set(query.pressureLevelsHpa).size !== query.pressureLevelsHpa.length) {
    context.addIssue({ code: "custom", path: ["pressureLevelsHpa"], message: "GEFS parcel pressure levels must not contain duplicates" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
});

const quantileSchema = z.object({ quantile: z.number().min(0).max(1), value: z.number() });
const numericDistributionSchema = z.object({
  memberCount: z.number().int().min(2),
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
const boundarySummarySchema = z.object({
  membersWithBoundary: rawMemberEventFractionSchema,
  pressureHpa: numericDistributionSchema.optional(),
  geopotentialHeightGpm: numericDistributionSchema.optional(),
});

export const gefsParcelDiagnosticsResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  sampledPressureLevelsHpa: z.array(gefsParcelPressureLevelSchema).min(2),
  selection: z.object({
    parcel: parcelDefinitionIdSchema,
    members: z.array(gefsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  methodology: z.object({
    pressureMoisture: z.literal("temperature_relative_humidity_pressure_to_specific_humidity_per_member"),
    surfaceMoisture: z.literal("2m_temperature_relative_humidity_surface_pressure_to_specific_humidity_per_member"),
    surfaceOrography: z.literal("same_cycle_f000_surface_geopotential_height"),
  }),
  summary: z.object({
    startingPressureHpa: numericDistributionSchema,
    startingTemperatureC: numericDistributionSchema,
    startingSpecificHumidityKgKg: numericDistributionSchema,
    lclPressureHpa: numericDistributionSchema,
    lclTemperatureC: numericDistributionSchema,
    capeJkg: numericDistributionSchema,
    cinJkg: numericDistributionSchema,
    membersWithPositiveCape: rawMemberEventFractionSchema,
    lfc: boundarySummarySchema,
    el: boundarySummarySchema,
  }),
  members: z.array(z.object({
    member: gefsMemberSchema,
    forecastCacheHit: z.boolean(),
    surfaceOrographyCacheHit: z.boolean(),
    levels: z.array(profileLevelResultSchema).min(2),
    parcel: parcelComputationSchema,
  })).min(2).optional(),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsParcelDiagnosticsQueryInput = z.input<typeof gefsParcelDiagnosticsQuerySchema>;
export type GefsParcelDiagnosticsResult = z.infer<typeof gefsParcelDiagnosticsResultSchema>;
