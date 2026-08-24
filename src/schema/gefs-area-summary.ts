import * as z from "zod/v4";
import { GEFS_PGRB2A_RAW_FIELD_IDS } from "../catalog/gefs-fields.js";
import {
  GEFS_MEMBERS,
  GEFS_PGRB2A_PRESSURE_VARIABLES,
  isSupportedGefsPressureSelection,
} from "../catalog/gefs.js";
import { AREA_PERCENTILE_METHOD, areaThresholdSchema } from "./area-summary.js";
import { gefsMemberSchema, gefsRunSelectorSchema } from "./gefs-ensemble.js";
import { gefsNumericDistributionSchema, gefsFieldTemporalResultSchema } from "./gefs-member-bundle.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const DEFAULT_GEFS_AREA_MAX_GRID_POINTS = 12_500;
export const DEFAULT_GEFS_AREA_MAX_MEMBER_GRID_POINTS = 250_000;
export const MAX_GEFS_AREA_MEMBER_GRID_POINTS = 2_000_000;

const gefsAreaPressureVariableSchema = z.enum(GEFS_PGRB2A_PRESSURE_VARIABLES);
const gefsAreaFieldSchema = z.enum(GEFS_PGRB2A_RAW_FIELD_IDS);

export const gefsAreaSummaryQuerySchema = z.object({
  westLongitude: z.number().min(-180).max(180),
  eastLongitude: z.number().min(-180).max(180),
  southLatitude: z.number().min(-90).max(90),
  northLatitude: z.number().min(-90).max(90),
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the GEFS native cadence"),
  variable: gefsAreaPressureVariableSchema.optional(),
  pressureLevelHpa: z.number().positive().optional(),
  field: gefsAreaFieldSchema.optional(),
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]).describe(
    "Quantiles across member-level spatial statistics",
  ),
  percentiles: z.array(z.number().min(0).max(100)).max(20).optional().describe(
    "Spatial percentiles calculated independently inside every member before ensemble aggregation",
  ),
  thresholds: z.array(areaThresholdSchema).max(20).optional().describe(
    "Spatial threshold fractions calculated independently inside every member before ensemble aggregation",
  ),
  includeExtremaLocations: z.boolean().default(false).describe(
    "Include each member's representative min/max grid location and tie count",
  ),
  includeMembers: z.boolean().default(false).describe(
    "Include each member's complete spatial summary in addition to ensemble distributions",
  ),
  maxGridPoints: z.number().int().min(1).max(300_000).default(DEFAULT_GEFS_AREA_MAX_GRID_POINTS),
  maxMemberGridPoints: z.number().int().min(2).max(MAX_GEFS_AREA_MEMBER_GRID_POINTS).default(DEFAULT_GEFS_AREA_MAX_MEMBER_GRID_POINTS),
}).superRefine((query, context) => {
  if (query.eastLongitude <= query.westLongitude) {
    context.addIssue({ code: "custom", path: ["eastLongitude"], message: "eastLongitude must be greater than westLongitude; antimeridian-crossing boxes are not supported yet" });
  }
  if (query.northLatitude <= query.southLatitude) {
    context.addIssue({ code: "custom", path: ["northLatitude"], message: "northLatitude must be greater than southLatitude" });
  }

  const hasField = query.field !== undefined;
  const hasVariable = query.variable !== undefined;
  const hasLevel = query.pressureLevelHpa !== undefined;
  if (hasField) {
    if (hasVariable || hasLevel) {
      context.addIssue({ code: "custom", path: ["field"], message: "GEFS area summary accepts either field or variable+pressureLevelHpa, not both" });
    }
  } else if (!hasVariable || !hasLevel) {
    context.addIssue({ code: "custom", path: [hasVariable ? "pressureLevelHpa" : "variable"], message: "GEFS pressure-level area summary requires variable and pressureLevelHpa together" });
  } else if (!isSupportedGefsPressureSelection(query.variable!, query.pressureLevelHpa!)) {
    context.addIssue({ code: "custom", path: ["pressureLevelHpa"], message: `GEFS pgrb2a does not publish ${query.variable} at ${query.pressureLevelHpa} hPa` });
  }

  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "GEFS ensemble quantiles must not contain duplicates" });
  }
  if (query.percentiles !== undefined && new Set(query.percentiles).size !== query.percentiles.length) {
    context.addIssue({ code: "custom", path: ["percentiles"], message: "GEFS spatial percentiles must not contain duplicates" });
  }
});

const memberExtremumSchema = z.object({
  value: z.number(),
  gridPoint: pointCoordinateSchema,
  tiedGridPoints: z.number().int().positive(),
});

const memberAreaSummarySchema = z.object({
  member: gefsMemberSchema,
  cacheHit: z.boolean(),
  statistics: z.object({
    definedGridPoints: z.number().int().positive(),
    mean: z.number(),
    min: z.number(),
    max: z.number(),
  }),
  percentiles: z.array(z.object({ percentile: z.number().min(0).max(100), value: z.number() })).optional(),
  thresholdFractions: z.array(z.object({
    operator: z.enum(["gte", "lte"]),
    threshold: z.number(),
    matchingGridPoints: z.number().int().nonnegative(),
    fraction: z.number().min(0).max(1),
  })).optional(),
  extrema: z.object({ min: memberExtremumSchema, max: memberExtremumSchema }).optional(),
});

export const gefsAreaSummaryResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  bbox: z.object({
    westLongitude: z.number(),
    eastLongitude: z.number(),
    southLatitude: z.number(),
    northLatitude: z.number(),
  }),
  selection: z.object({
    variable: gefsAreaPressureVariableSchema.optional(),
    pressureLevelHpa: z.number().positive().optional(),
    field: gefsAreaFieldSchema.optional(),
    outputField: z.string().min(1),
    unit: z.string().min(1),
    temporal: gefsFieldTemporalResultSchema.optional(),
    members: z.array(gefsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  methodology: z.literal("spatial_statistics_per_member_then_ensemble_distribution"),
  statistics: z.object({
    definedGridPoints: gefsNumericDistributionSchema,
    mean: gefsNumericDistributionSchema,
    min: gefsNumericDistributionSchema,
    max: gefsNumericDistributionSchema,
  }),
  spatialPercentiles: z.array(z.object({
    percentile: z.number().min(0).max(100),
    percentileMethod: z.literal(AREA_PERCENTILE_METHOD),
    distribution: gefsNumericDistributionSchema,
  })).optional(),
  spatialThresholdFractions: z.array(z.object({
    operator: z.enum(["gte", "lte"]),
    threshold: z.number(),
    distribution: gefsNumericDistributionSchema,
    interpretation: z.literal("distribution_of_raw_member_spatial_fractions_not_calibrated_probability"),
  })).optional(),
  memberExtrema: z.array(z.object({
    member: gefsMemberSchema,
    min: memberExtremumSchema,
    max: memberExtremumSchema,
  })).optional(),
  members: z.array(memberAreaSummarySchema).min(2).optional(),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsAreaSummaryQueryInput = z.input<typeof gefsAreaSummaryQuerySchema>;
export type GefsAreaSummaryResult = z.infer<typeof gefsAreaSummaryResultSchema>;
