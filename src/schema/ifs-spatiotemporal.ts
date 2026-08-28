import * as z from "zod/v4";
import {
  ifsFieldResultSchema,
  ifsFieldSchema,
  ifsPressureLevelSchema,
  ifsPressureVariableSchema,
  ifsProfileResultSchema,
  ifsRunSelectorSchema,
} from "./ifs.js";
import { gridPointSchema, profileLevelResultSchema } from "./result.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

const selectionShape = {
  variables: z.array(ifsPressureVariableSchema).min(1).optional(),
  pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(1).optional(),
  fields: z.array(ifsFieldSchema).min(1).optional(),
};

function validateSelection(
  query: { variables?: unknown[] | undefined; pressureLevelsHpa?: unknown[] | undefined; fields?: unknown[] | undefined },
  context: z.RefinementCtx,
): void {
  const hasVariables = query.variables !== undefined;
  const hasLevels = query.pressureLevelsHpa !== undefined;
  if (hasVariables !== hasLevels) {
    context.addIssue({
      code: "custom",
      path: hasVariables ? ["pressureLevelsHpa"] : ["variables"],
      message: "IFS pressure variables and pressureLevelsHpa must be supplied together",
    });
  }
  if (!hasVariables && query.fields === undefined) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Request at least one IFS pressure variable or field",
    });
  }
}

export const IFS_MAX_NATIVE_STEPS = 85;
export const IFS_DEFAULT_TIME_SERIES_MAX_STEPS = 85;
export const IFS_DEFAULT_POINTS_MAX = 20;
export const IFS_DEFAULT_POINT_STEPS_MAX = 1_700;
export const IFS_MAX_POINT_STEPS = 5_000;
export const IFS_DEFAULT_TRANSECT_SAMPLES = 21;
export const IFS_MAX_TRANSECT_SAMPLES = 50;

export const ifsTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  ...selectionShape,
  maxSteps: z.number().int().min(1).max(IFS_MAX_NATIVE_STEPS).default(IFS_DEFAULT_TIME_SERIES_MAX_STEPS),
}).superRefine((query, context) => {
  validateSelection(query, context);
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be at or after startTime" });
  }
});

export const ifsPointsQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(50),
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema,
  ...selectionShape,
}).superRefine(validateSelection);

export const ifsPointsTimeSeriesQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(50),
  run: ifsRunSelectorSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  ...selectionShape,
  maxSteps: z.number().int().min(1).max(IFS_MAX_NATIVE_STEPS).default(IFS_DEFAULT_TIME_SERIES_MAX_STEPS),
  maxPointSteps: z.number().int().min(1).max(IFS_MAX_POINT_STEPS).default(IFS_DEFAULT_POINT_STEPS_MAX),
}).superRefine((query, context) => {
  validateSelection(query, context);
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be at or after startTime" });
  }
});

export const ifsTransectQuerySchema = z.object({
  start: pointCoordinateSchema,
  end: pointCoordinateSchema,
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema,
  ...selectionShape,
  samples: z.number().int().min(2).max(IFS_MAX_TRANSECT_SAMPLES).default(IFS_DEFAULT_TRANSECT_SAMPLES),
}).superRefine((query, context) => {
  validateSelection(query, context);
  if (query.start.latitude === query.end.latitude && query.start.longitude === query.end.longitude) {
    context.addIssue({ code: "custom", path: ["end"], message: "Transect start and end coordinates must differ" });
  }
});

const ifsSourceSchema = ifsProfileResultSchema.shape.source.omit({ cacheHit: true });

export const ifsTimeSeriesResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  run: isoDateTimeSchema,
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  requestedPoint: gridPointSchema,
  source: ifsSourceSchema,
  series: z.array(z.object({
    validTime: isoDateTimeSchema,
    forecastHour: z.number().int().min(0).max(240),
    gridPoint: gridPointSchema,
    levels: z.array(profileLevelResultSchema),
    fields: z.array(ifsFieldResultSchema).optional(),
    cacheHit: z.boolean(),
  })),
});

export const ifsPointSampleResultSchema = z.object({
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  levels: z.array(profileLevelResultSchema),
  fields: z.array(ifsFieldResultSchema).optional(),
});

export const ifsPointsResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(240),
  points: z.array(ifsPointSampleResultSchema),
  source: ifsSourceSchema.extend({ allCacheHit: z.boolean() }),
});

export const ifsPointsTimeSeriesResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  run: isoDateTimeSchema,
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  source: ifsSourceSchema,
  series: z.array(z.object({
    validTime: isoDateTimeSchema,
    forecastHour: z.number().int().min(0).max(240),
    points: z.array(ifsPointSampleResultSchema),
    allCacheHit: z.boolean(),
  })),
});

export const ifsTransectResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(240),
  startPoint: gridPointSchema,
  endPoint: gridPointSchema,
  totalDistanceKm: z.number().nonnegative(),
  samples: z.array(z.object({
    index: z.number().int().nonnegative(),
    fraction: z.number().min(0).max(1),
    distanceKm: z.number().nonnegative(),
    requestedPoint: gridPointSchema,
    gridPoint: gridPointSchema,
    levels: z.array(profileLevelResultSchema),
    fields: z.array(ifsFieldResultSchema).optional(),
  })),
  source: ifsSourceSchema.extend({ allCacheHit: z.boolean() }),
});

export type IfsTimeSeriesQueryInput = z.input<typeof ifsTimeSeriesQuerySchema>;
export type IfsTimeSeriesResult = z.infer<typeof ifsTimeSeriesResultSchema>;
export type IfsPointsQueryInput = z.input<typeof ifsPointsQuerySchema>;
export type IfsPointsResult = z.infer<typeof ifsPointsResultSchema>;
export type IfsPointsTimeSeriesQueryInput = z.input<typeof ifsPointsTimeSeriesQuerySchema>;
export type IfsPointsTimeSeriesResult = z.infer<typeof ifsPointsTimeSeriesResultSchema>;
export type IfsTransectQueryInput = z.input<typeof ifsTransectQuerySchema>;
export type IfsTransectResult = z.infer<typeof ifsTransectResultSchema>;
