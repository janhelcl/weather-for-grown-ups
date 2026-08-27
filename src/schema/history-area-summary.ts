import * as z from "zod/v4";
import {
  HISTORICAL_AREA_FIELD_IDS,
  HISTORICAL_AREA_PRESSURE_VARIABLE_IDS,
} from "../catalog/history-area.js";
import { NON_ISOBARIC_FIELD_CATALOG } from "../catalog/non-isobaric-fields.js";
import { AREA_PERCENTILE_METHOD, areaThresholdSchema } from "./area-summary.js";
import { historicalAnalysisTimeSchema } from "./history.js";
import {
  gridPointSchema,
  nonIsobaricFieldLevelResultSchema,
} from "./result.js";
import { pressureLevelSchema } from "./query.js";

export const DEFAULT_HISTORICAL_AREA_MAX_GRID_POINTS = 12_500;
export const MAX_HISTORICAL_AREA_MAX_GRID_POINTS = 300_000;

export const historicalAreaPressureVariableSchema = z.enum(HISTORICAL_AREA_PRESSURE_VARIABLE_IDS);
export const historicalAreaFieldSchema = z.enum(HISTORICAL_AREA_FIELD_IDS);

export const historicalAreaSummaryQuerySchema = z.object({
  westLongitude: z.number().min(-180).max(180),
  eastLongitude: z.number().min(-180).max(180),
  southLatitude: z.number().min(-90).max(90),
  northLatitude: z.number().min(-90).max(90),
  analysisTime: historicalAnalysisTimeSchema,
  variable: historicalAreaPressureVariableSchema.optional(),
  pressureLevelHpa: pressureLevelSchema.optional(),
  field: historicalAreaFieldSchema.optional(),
  percentiles: z.array(z.number().min(0).max(100)).max(20).optional(),
  thresholds: z.array(areaThresholdSchema).max(20).optional(),
  includeExtremaLocations: z.boolean().default(false),
  maxGridPoints: z.number().int().min(1).max(MAX_HISTORICAL_AREA_MAX_GRID_POINTS)
    .default(DEFAULT_HISTORICAL_AREA_MAX_GRID_POINTS),
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

  const hasVariable = query.variable !== undefined;
  const hasLevel = query.pressureLevelHpa !== undefined;
  const hasField = query.field !== undefined;
  if (hasField) {
    if (hasVariable || hasLevel) {
      context.addIssue({
        code: "custom",
        path: ["field"],
        message: "Historical area summary accepts either field or variable+pressureLevelHpa, not both",
      });
    }
  } else if (!hasVariable || !hasLevel) {
    context.addIssue({
      code: "custom",
      path: [hasVariable ? "pressureLevelHpa" : "variable"],
      message: "Historical pressure-level area summary requires variable and pressureLevelHpa together",
    });
  }

  if (query.percentiles !== undefined && new Set(query.percentiles).size !== query.percentiles.length) {
    context.addIssue({
      code: "custom",
      path: ["percentiles"],
      message: "Historical area percentiles must be unique",
    });
  }
});

const bboxSchema = z.object({
  westLongitude: z.number(),
  eastLongitude: z.number(),
  southLatitude: z.number(),
  northLatitude: z.number(),
});

const areaDistributionSchema = z.object({
  percentileMethod: z.literal(AREA_PERCENTILE_METHOD).optional(),
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
    min: z.object({
      value: z.number(),
      gridPoint: gridPointSchema,
      tiedGridPoints: z.number().int().positive(),
    }),
    max: z.object({
      value: z.number(),
      gridPoint: gridPointSchema,
      tiedGridPoints: z.number().int().positive(),
    }),
  }).optional(),
}).superRefine((distribution, context) => {
  if (distribution.percentiles !== undefined && distribution.percentileMethod === undefined) {
    context.addIssue({
      code: "custom",
      path: ["percentileMethod"],
      message: "Percentile results require an explicit method",
    });
  }
  if (distribution.percentiles === undefined && distribution.percentileMethod !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["percentileMethod"],
      message: "Percentile method is only returned with percentile results",
    });
  }
});

export const historicalAreaSummaryResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  analysisTime: historicalAnalysisTimeSchema,
  bbox: bboxSchema,
  variable: z.object({
    id: historicalAreaPressureVariableSchema,
    pressureHpa: z.number().positive(),
    field: z.string().min(1),
    unit: z.string().min(1),
  }).optional(),
  field: z.object({
    id: historicalAreaFieldSchema,
    level: nonIsobaricFieldLevelResultSchema,
    temporal: z.object({ type: z.literal("instantaneous") }),
    output: z.object({ field: z.string().min(1), unit: z.string().min(1) }),
  }).optional(),
  statistics: z.object({
    definedGridPoints: z.number().int().positive(),
    mean: z.number(),
    min: z.number(),
    max: z.number(),
    meanKind: z.literal("unweighted_grid_point_mean"),
  }),
  distribution: areaDistributionSchema.optional(),
  source: z.object({
    provider: z.literal("NOAA NCEI"),
    access: z.literal("ncei_thredds_ncss"),
    subset: z.literal("native_bbox_grid"),
    dataset: z.string().min(1),
    cacheHit: z.boolean(),
  }),
  caveat: z.literal(
    "GFS model analysis area statistics; not direct observations or homogeneous climatological reanalysis",
  ),
}).superRefine((result, context) => {
  if (Number(result.variable !== undefined) + Number(result.field !== undefined) !== 1) {
    context.addIssue({
      code: "custom",
      path: ["field"],
      message: "Historical area summary must describe exactly one pressure variable or field",
    });
  }
});

export function historicalAreaFieldLevel(fieldId: z.infer<typeof historicalAreaFieldSchema>) {
  const level = NON_ISOBARIC_FIELD_CATALOG[fieldId].level;
  if (level.type === "surface") return { type: "surface" as const };
  if (level.type === "height_above_ground_m") {
    return { type: "height_above_ground_m" as const, heightM: level.heightM };
  }
  if (level.type === "named_layer") return { type: "named_layer" as const, id: level.id };
  return { type: "named_level" as const, id: level.id };
}

export type HistoricalAreaSummaryQueryInput = z.input<typeof historicalAreaSummaryQuerySchema>;
export type HistoricalAreaSummaryResult = z.infer<typeof historicalAreaSummaryResultSchema>;
