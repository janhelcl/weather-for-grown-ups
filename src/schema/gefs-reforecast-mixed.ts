import * as z from "zod/v4";
import {
  GEFS_REFORECAST_EXTENDED_MEMBERS,
  GEFS_REFORECAST_FIELD_IDS,
  GEFS_REFORECAST_PRESSURE_VARIABLE_IDS,
  GEFS_REFORECAST_STANDARD_MEMBERS,
  isSupportedGefsReforecastPressureSelection,
} from "../catalog/gefs-reforecast.js";
import {
  GEFS_REFORECAST_MAX_POINTS,
  GEFS_REFORECAST_POINTS_DEFAULT_MAX_MEMBER_SAMPLES,
  GEFS_REFORECAST_POINTS_MAX_MEMBER_SAMPLES,
  GEFS_REFORECAST_POINTS_TIME_SERIES_DEFAULT_MAX_POINT_STEPS,
  GEFS_REFORECAST_POINTS_TIME_SERIES_MAX_POINT_STEPS,
  GEFS_REFORECAST_TIME_SERIES_DEFAULT_MAX_STEPS,
  GEFS_REFORECAST_TIME_SERIES_MAX_STEPS,
  gefsReforecastFieldSchema,
  gefsReforecastMemberSchema,
  gefsReforecastPointResultSchema,
  gefsReforecastProfileResultSchema,
  gefsReforecastProfileVariableSchema,
} from "./gefs-reforecast.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

const mixedSelectionShape = {
  variables: z.array(gefsReforecastProfileVariableSchema)
    .min(1)
    .max(GEFS_REFORECAST_PRESSURE_VARIABLE_IDS.length),
  pressureLevelsHpa: z.array(z.number().positive()).min(1).max(25),
  fields: z.array(gefsReforecastFieldSchema)
    .min(1)
    .max(GEFS_REFORECAST_FIELD_IDS.length),
};

const mixedCommonShape = {
  run: isoDateTimeSchema,
  members: z.array(gefsReforecastMemberSchema)
    .min(2)
    .max(GEFS_REFORECAST_EXTENDED_MEMBERS.length)
    .default([...GEFS_REFORECAST_STANDARD_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1))
    .min(1)
    .max(9)
    .default([0.1, 0.5, 0.9]),
};

function validateMixedSelection(query: {
  variables: readonly string[];
  pressureLevelsHpa: readonly number[];
  fields: readonly string[];
  members: readonly string[];
  quantiles: readonly number[];
}, context: z.RefinementCtx): void {
  if (new Set(query.variables).size !== query.variables.length) {
    context.addIssue({ code: "custom", path: ["variables"], message: "GEFSv12 reforecast mixed variables must not contain duplicates" });
  }
  if (new Set(query.pressureLevelsHpa).size !== query.pressureLevelsHpa.length) {
    context.addIssue({ code: "custom", path: ["pressureLevelsHpa"], message: "GEFSv12 reforecast mixed pressure levels must not contain duplicates" });
  }
  if (new Set(query.fields).size !== query.fields.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "GEFSv12 reforecast mixed fields must not contain duplicates" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFSv12 reforecast members must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantiles must not contain duplicates" });
  }
  const supportedVariables = new Set<string>(GEFS_REFORECAST_PRESSURE_VARIABLE_IDS);
  for (const variable of query.variables) {
    if (!supportedVariables.has(variable)) continue;
    for (const pressureLevelHpa of query.pressureLevelsHpa) {
      if (!isSupportedGefsReforecastPressureSelection(variable as any, pressureLevelHpa)) {
        context.addIssue({
          code: "custom",
          path: ["pressureLevelsHpa"],
          message: `GEFSv12 reforecast cannot satisfy ${variable} at ${pressureLevelHpa} hPa`,
        });
      }
    }
  }
}

export const gefsReforecastMixedPointQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  ...mixedCommonShape,
  validTime: isoDateTimeSchema,
  ...mixedSelectionShape,
  includeMembers: z.boolean().default(false),
}).superRefine(validateMixedSelection);

const mixedSelectionResultSchema = z.object({
  variables: z.array(gefsReforecastProfileVariableSchema).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
  fields: z.array(gefsReforecastFieldSchema).min(1),
  members: z.array(gefsReforecastMemberSchema).min(2),
  quantiles: z.array(z.number().min(0).max(1)).min(1),
});

const pressureBlockSchema = z.object({
  gridPoint: pointCoordinateSchema,
  summaries: gefsReforecastProfileResultSchema.shape.summaries,
  members: gefsReforecastProfileResultSchema.shape.members,
  source: z.object({
    horizontalGridDegrees: z.union([z.literal(0.25), z.literal(0.5)]),
    profileGridPolicy: z.enum(["native_0p25", "native_0p50", "coherent_0p50"]),
    allCacheHit: z.boolean(),
  }),
});

const fieldBlockSchema = z.object({
  gridPoint: pointCoordinateSchema,
  fieldSummaries: gefsReforecastPointResultSchema.shape.fieldSummaries,
  members: gefsReforecastPointResultSchema.shape.members,
  source: z.object({
    horizontalGridDegrees: z.union([z.literal(0.25), z.literal(0.5)]),
    allCacheHit: z.boolean(),
  }),
});

const mixedSourceSchema = z.object({
  provider: z.literal("NOAA AWS Open Data"),
  access: z.literal("s3_range"),
  decoder: z.enum(["gribberish", "wgrib2"]),
  archiveType: z.literal("reforecast"),
  dataset: z.literal("GEFSv12/reforecast"),
  leadBlock: z.enum(["Days:1-10", "Days:10-16"]),
  gridSemantics: z.literal("pressure_and_field_grids_reported_separately"),
  allCacheHit: z.boolean(),
});

export const gefsReforecastMixedPointResultSchema = z.object({
  model: z.literal("gefs_v12_reforecast"),
  kind: z.literal("mixed"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(3).max(384),
  requestedPoint: pointCoordinateSchema,
  selection: mixedSelectionResultSchema,
  pressure: pressureBlockSchema,
  fields: fieldBlockSchema,
  source: mixedSourceSchema,
});

export const gefsReforecastMixedPointsQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(GEFS_REFORECAST_MAX_POINTS),
  ...mixedCommonShape,
  validTime: isoDateTimeSchema,
  ...mixedSelectionShape,
  includeMembers: z.boolean().default(false),
  maxMemberSamples: z.number().int().min(1).max(GEFS_REFORECAST_POINTS_MAX_MEMBER_SAMPLES)
    .default(GEFS_REFORECAST_POINTS_DEFAULT_MAX_MEMBER_SAMPLES),
}).superRefine(validateMixedSelection);

const mixedPointSampleSchema = z.object({
  requestedPoint: pointCoordinateSchema,
  pressure: pressureBlockSchema,
  fields: fieldBlockSchema,
});

export const gefsReforecastMixedPointsResultSchema = z.object({
  model: z.literal("gefs_v12_reforecast"),
  kind: z.literal("mixed"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(3).max(384),
  selection: mixedSelectionResultSchema,
  includeMembers: z.boolean(),
  points: z.array(mixedPointSampleSchema).min(1).max(GEFS_REFORECAST_MAX_POINTS),
  source: mixedSourceSchema,
});

export const gefsReforecastMixedTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  ...mixedCommonShape,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  ...mixedSelectionShape,
  maxSteps: z.number().int().min(1).max(GEFS_REFORECAST_TIME_SERIES_MAX_STEPS)
    .default(GEFS_REFORECAST_TIME_SERIES_DEFAULT_MAX_STEPS),
}).superRefine((query, context) => {
  validateMixedSelection(query, context);
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be at or after startTime" });
  }
});

const mixedTimeSeriesStepSchema = z.object({
  kind: z.literal("mixed"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(3).max(384),
  pressure: pressureBlockSchema.omit({ members: true }),
  fields: fieldBlockSchema.omit({ members: true }),
});

const nativeCadenceSchema = z.tuple([
  z.object({
    fromForecastHour: z.literal(3),
    throughForecastHour: z.literal(240),
    stepHours: z.literal(3),
  }),
  z.object({
    fromForecastHour: z.literal(246),
    throughForecastHour: z.literal(384),
    stepHours: z.literal(6),
  }),
]);

export const gefsReforecastMixedTimeSeriesResultSchema = z.object({
  model: z.literal("gefs_v12_reforecast"),
  run: isoDateTimeSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  requestedPoint: pointCoordinateSchema,
  selection: mixedSelectionResultSchema,
  series: z.array(mixedTimeSeriesStepSchema).min(1).max(GEFS_REFORECAST_TIME_SERIES_MAX_STEPS),
  source: mixedSourceSchema.omit({ leadBlock: true }).extend({
    nativeCadence: nativeCadenceSchema,
  }),
});

export const gefsReforecastMixedPointsTimeSeriesQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(GEFS_REFORECAST_MAX_POINTS),
  ...mixedCommonShape,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  ...mixedSelectionShape,
  maxSteps: z.number().int().min(1).max(GEFS_REFORECAST_TIME_SERIES_MAX_STEPS)
    .default(GEFS_REFORECAST_TIME_SERIES_DEFAULT_MAX_STEPS),
  maxPointSteps: z.number().int().min(1).max(GEFS_REFORECAST_POINTS_TIME_SERIES_MAX_POINT_STEPS)
    .default(GEFS_REFORECAST_POINTS_TIME_SERIES_DEFAULT_MAX_POINT_STEPS),
}).superRefine((query, context) => {
  validateMixedSelection(query, context);
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be at or after startTime" });
  }
});

const mixedPointsTimeSeriesStepSchema = z.object({
  kind: z.literal("mixed"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(3).max(384),
  points: z.array(mixedPointSampleSchema.extend({
    pressure: pressureBlockSchema.omit({ members: true }),
    fields: fieldBlockSchema.omit({ members: true }),
  })).min(1).max(GEFS_REFORECAST_MAX_POINTS),
  source: mixedSourceSchema.pick({
    leadBlock: true,
    allCacheHit: true,
  }),
});

export const gefsReforecastMixedPointsTimeSeriesResultSchema = z.object({
  model: z.literal("gefs_v12_reforecast"),
  run: isoDateTimeSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  selection: mixedSelectionResultSchema,
  series: z.array(mixedPointsTimeSeriesStepSchema).min(1).max(GEFS_REFORECAST_TIME_SERIES_MAX_STEPS),
  source: mixedSourceSchema.omit({ leadBlock: true }).extend({
    nativeCadence: nativeCadenceSchema,
  }),
});

export type GefsReforecastMixedPointQueryInput = z.input<typeof gefsReforecastMixedPointQuerySchema>;
export type GefsReforecastMixedPointResult = z.infer<typeof gefsReforecastMixedPointResultSchema>;
export type GefsReforecastMixedPointsQueryInput = z.input<typeof gefsReforecastMixedPointsQuerySchema>;
export type GefsReforecastMixedPointsResult = z.infer<typeof gefsReforecastMixedPointsResultSchema>;
export type GefsReforecastMixedTimeSeriesQueryInput = z.input<typeof gefsReforecastMixedTimeSeriesQuerySchema>;
export type GefsReforecastMixedTimeSeriesResult = z.infer<typeof gefsReforecastMixedTimeSeriesResultSchema>;
export type GefsReforecastMixedPointsTimeSeriesQueryInput = z.input<typeof gefsReforecastMixedPointsTimeSeriesQuerySchema>;
export type GefsReforecastMixedPointsTimeSeriesResult = z.infer<typeof gefsReforecastMixedPointsTimeSeriesResultSchema>;
