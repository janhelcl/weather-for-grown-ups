import * as z from "zod/v4";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import { AREA_PERCENTILE_METHOD, areaThresholdSchema } from "./area-summary.js";
import {
  IFS_AREA_FIELD_IDS,
  IFS_AREA_PRESSURE_VARIABLE_IDS,
} from "./ifs-area-summary.js";
import {
  ifsEnsMemberSchema,
  ifsEnsNumericDistributionSchema,
} from "./ifs-ens.js";
import { ifsPressureLevelSchema, ifsRunSelectorSchema } from "./ifs.js";
import {
  fieldTemporalResultSchema,
  gridPointSchema,
  nonIsobaricFieldLevelResultSchema,
} from "./result.js";
import { isoDateTimeSchema } from "./query.js";

export const DEFAULT_IFS_ENS_AREA_MAX_GRID_POINTS = 50_000;
export const DEFAULT_IFS_ENS_AREA_MAX_MEMBER_GRID_POINTS = 250_000;
export const MAX_IFS_ENS_AREA_MEMBER_GRID_POINTS = 2_000_000;

const ifsEnsAreaPressureVariableSchema = z.enum(IFS_AREA_PRESSURE_VARIABLE_IDS);
const ifsEnsAreaFieldSchema = z.enum(IFS_AREA_FIELD_IDS);

export const ifsEnsAreaSummaryQuerySchema = z.object({
  westLongitude: z.number().min(-180).max(180),
  eastLongitude: z.number().min(-180).max(180),
  southLatitude: z.number().min(-90).max(90),
  northLatitude: z.number().min(-90).max(90),
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema,
  variable: ifsEnsAreaPressureVariableSchema.optional(),
  pressureLevelHpa: ifsPressureLevelSchema.optional(),
  field: ifsEnsAreaFieldSchema.optional(),
  members: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).default([...IFS_ENS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  percentiles: z.array(z.number().min(0).max(100)).max(20).optional(),
  thresholds: z.array(areaThresholdSchema).max(20).optional(),
  includeExtremaLocations: z.boolean().default(false),
  includeMembers: z.boolean().default(false).describe(
    "Include each perturbation's spatial summary; raw grid values are never returned",
  ),
  maxGridPoints: z.number().int().min(1).max(1_100_000).default(DEFAULT_IFS_ENS_AREA_MAX_GRID_POINTS),
  maxMemberGridPoints: z.number().int().min(2).max(MAX_IFS_ENS_AREA_MEMBER_GRID_POINTS)
    .default(DEFAULT_IFS_ENS_AREA_MAX_MEMBER_GRID_POINTS),
}).superRefine((query, context) => {
  if (query.eastLongitude <= query.westLongitude) {
    context.addIssue({
      code: "custom",
      path: ["eastLongitude"],
      message: "eastLongitude must be greater than westLongitude; antimeridian-crossing boxes are not supported yet",
    });
  }
  if (query.northLatitude <= query.southLatitude) {
    context.addIssue({
      code: "custom",
      path: ["northLatitude"],
      message: "northLatitude must be greater than southLatitude",
    });
  }

  const hasField = query.field !== undefined;
  const hasVariable = query.variable !== undefined;
  const hasLevel = query.pressureLevelHpa !== undefined;
  if (hasField) {
    if (hasVariable || hasLevel) {
      context.addIssue({
        code: "custom",
        path: ["field"],
        message: "IFS ENS area summary accepts either field or variable+pressureLevelHpa, not both",
      });
    }
  } else if (!hasVariable || !hasLevel) {
    context.addIssue({
      code: "custom",
      path: [hasVariable ? "pressureLevelHpa" : "variable"],
      message: "IFS ENS pressure-level area summary requires variable and pressureLevelHpa together",
    });
  }

  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "IFS ENS members must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantiles must not contain duplicates" });
  }
  if (query.percentiles !== undefined && new Set(query.percentiles).size !== query.percentiles.length) {
    context.addIssue({ code: "custom", path: ["percentiles"], message: "Area percentiles must be unique" });
  }
});

const memberExtremumSchema = z.object({
  value: z.number(),
  gridPoint: gridPointSchema,
  tiedGridPoints: z.number().int().positive(),
});

const memberAreaSummarySchema = z.object({
  member: ifsEnsMemberSchema,
  cacheHit: z.boolean(),
  statistics: z.object({
    definedGridPoints: z.number().int().positive(),
    mean: z.number(),
    min: z.number(),
    max: z.number(),
  }),
  percentiles: z.array(z.object({
    percentile: z.number().min(0).max(100),
    value: z.number(),
  })).optional(),
  thresholdFractions: z.array(z.object({
    operator: z.enum(["gte", "lte"]),
    threshold: z.number(),
    matchingGridPoints: z.number().int().nonnegative(),
    fraction: z.number().min(0).max(1),
  })).optional(),
  extrema: z.object({
    min: memberExtremumSchema,
    max: memberExtremumSchema,
  }).optional(),
});

export const ifsEnsAreaSummaryResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  bbox: z.object({
    westLongitude: z.number(),
    eastLongitude: z.number(),
    southLatitude: z.number(),
    northLatitude: z.number(),
  }),
  selection: z.object({
    variable: ifsEnsAreaPressureVariableSchema.optional(),
    pressureLevelHpa: ifsPressureLevelSchema.optional(),
    field: ifsEnsAreaFieldSchema.optional(),
    level: nonIsobaricFieldLevelResultSchema.optional(),
    temporal: fieldTemporalResultSchema.optional(),
    outputField: z.string().min(1),
    unit: z.string().min(1),
    members: z.array(ifsEnsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  methodology: z.literal("spatial_statistics_per_member_then_ensemble_distribution"),
  statistics: z.object({
    definedGridPoints: ifsEnsNumericDistributionSchema,
    mean: ifsEnsNumericDistributionSchema,
    min: ifsEnsNumericDistributionSchema,
    max: ifsEnsNumericDistributionSchema,
  }),
  spatialPercentiles: z.array(z.object({
    percentile: z.number().min(0).max(100),
    percentileMethod: z.literal(AREA_PERCENTILE_METHOD),
    distribution: ifsEnsNumericDistributionSchema,
  })).optional(),
  spatialThresholdFractions: z.array(z.object({
    operator: z.enum(["gte", "lte"]),
    threshold: z.number(),
    distribution: ifsEnsNumericDistributionSchema,
    interpretation: z.literal("distribution_of_raw_member_spatial_fractions_not_calibrated_probability"),
  })).optional(),
  memberExtrema: z.array(z.object({
    member: ifsEnsMemberSchema,
    min: memberExtremumSchema,
    max: memberExtremumSchema,
  })).optional(),
  members: z.array(memberAreaSummarySchema).min(2).optional(),
  source: z.object({
    provider: z.literal("ECMWF Open Data"),
    access: z.literal("indexed_http_range"),
    decoder: z.literal("gribberish"),
    product: z.literal("ifs_0p25_enfo_ef"),
    horizontalGridDegrees: z.literal(0.25),
    allCacheHit: z.boolean(),
    memberSemantics: z.literal("50_perturbed_members_control_is_oper_fc"),
    sharedRunStaticProduct: z.literal("ifs_0p25_oper_fc").optional(),
  }),
}).superRefine((result, context) => {
  const pressure = result.selection.variable !== undefined || result.selection.pressureLevelHpa !== undefined;
  const field = result.selection.field !== undefined;
  if (Number(pressure) + Number(field) !== 1) {
    context.addIssue({
      code: "custom",
      path: ["selection"],
      message: "IFS ENS area summary must describe exactly one pressure variable or field",
    });
  }
});

export type IfsEnsAreaSummaryQueryInput = z.input<typeof ifsEnsAreaSummaryQuerySchema>;
export type IfsEnsAreaSummaryResult = z.infer<typeof ifsEnsAreaSummaryResultSchema>;
