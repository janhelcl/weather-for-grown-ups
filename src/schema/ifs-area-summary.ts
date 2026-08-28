import * as z from "zod/v4";
import {
  IFS_RAW_FIELD_IDS,
  IFS_RAW_PRESSURE_VARIABLE_IDS,
} from "../catalog/ifs.js";
import { AREA_PERCENTILE_METHOD, areaThresholdSchema } from "./area-summary.js";
import { ifsPressureLevelSchema, ifsRunSelectorSchema } from "./ifs.js";
import { gridPointSchema, nonIsobaricFieldLevelResultSchema, fieldTemporalResultSchema } from "./result.js";
import { isoDateTimeSchema } from "./query.js";

export const IFS_AREA_PRESSURE_VARIABLE_IDS = IFS_RAW_PRESSURE_VARIABLE_IDS
  .filter((id) => id !== "relative_vorticity") as readonly [
    "temperature",
    ..."relative_humidity"[]
  ];

export const IFS_AREA_FIELD_IDS = IFS_RAW_FIELD_IDS;

const ifsAreaPressureVariableSchema = z.enum([
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
  "divergence",
]);

const ifsAreaFieldSchema = z.enum(IFS_AREA_FIELD_IDS);

export const ifsAreaSummaryQuerySchema = z.object({
  westLongitude: z.number().min(-180).max(180),
  eastLongitude: z.number().min(-180).max(180),
  southLatitude: z.number().min(-90).max(90),
  northLatitude: z.number().min(-90).max(90),
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema,
  variable: ifsAreaPressureVariableSchema.optional(),
  pressureLevelHpa: ifsPressureLevelSchema.optional(),
  field: ifsAreaFieldSchema.optional(),
  maxGridPoints: z.number().int().min(1).max(1_100_000).default(50_000),
  percentiles: z.array(z.number().min(0).max(100)).max(20).optional(),
  thresholds: z.array(areaThresholdSchema).max(20).optional(),
  includeExtremaLocations: z.boolean().default(false),
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
  const pressure = query.variable !== undefined || query.pressureLevelHpa !== undefined;
  const field = query.field !== undefined;
  if (pressure && field) {
    context.addIssue({
      code: "custom",
      path: ["field"],
      message: "IFS area summary accepts either one raw pressure variable or one raw field, not both",
    });
  } else if (!field) {
    if (query.variable === undefined) {
      context.addIssue({ code: "custom", path: ["variable"], message: "IFS pressure-level area summary requires variable" });
    }
    if (query.pressureLevelHpa === undefined) {
      context.addIssue({ code: "custom", path: ["pressureLevelHpa"], message: "IFS pressure-level area summary requires pressureLevelHpa" });
    }
  }
  if (query.percentiles !== undefined && new Set(query.percentiles).size !== query.percentiles.length) {
    context.addIssue({
      code: "custom",
      path: ["percentiles"],
      message: "Area percentiles must be unique",
    });
  }
});

const distributionSchema = z.object({
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
    min: z.object({ value: z.number(), gridPoint: gridPointSchema, tiedGridPoints: z.number().int().positive() }),
    max: z.object({ value: z.number(), gridPoint: gridPointSchema, tiedGridPoints: z.number().int().positive() }),
  }).optional(),
});

export const ifsAreaSummaryResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  bbox: z.object({
    westLongitude: z.number(),
    eastLongitude: z.number(),
    southLatitude: z.number(),
    northLatitude: z.number(),
  }),
  variable: z.object({
    id: ifsAreaPressureVariableSchema,
    pressureHpa: ifsPressureLevelSchema,
    field: z.string(),
    unit: z.string(),
  }).optional(),
  field: z.object({
    id: ifsAreaFieldSchema,
    level: nonIsobaricFieldLevelResultSchema,
    temporal: fieldTemporalResultSchema,
    output: z.object({ field: z.string(), unit: z.string() }),
  }).optional(),
  statistics: z.object({
    definedGridPoints: z.number().int().positive(),
    mean: z.number(),
    min: z.number(),
    max: z.number(),
    meanKind: z.literal("unweighted_grid_point_mean"),
  }),
  distribution: distributionSchema.optional(),
  source: z.object({
    provider: z.literal("ECMWF Open Data"),
    access: z.literal("indexed_http_range"),
    decoder: z.literal("gribberish"),
    product: z.literal("ifs_0p25_oper_fc"),
    horizontalGridDegrees: z.literal(0.25),
    cacheHit: z.boolean(),
  }),
}).superRefine((result, context) => {
  if (Number(result.variable !== undefined) + Number(result.field !== undefined) !== 1) {
    context.addIssue({
      code: "custom",
      path: ["field"],
      message: "IFS area summary must describe exactly one pressure variable or field",
    });
  }
});

export type IfsAreaSummaryQueryInput = z.input<typeof ifsAreaSummaryQuerySchema>;
export type IfsAreaSummaryResult = z.infer<typeof ifsAreaSummaryResultSchema>;
