import * as z from "zod/v4";
import { LAYER_DIAGNOSTIC_IDS } from "../catalog/layer-diagnostics.js";
import { NON_ISOBARIC_FIELD_IDS } from "../catalog/non-isobaric-fields.js";
import { isSupportedGfsPressureLevel } from "../catalog/pressure-levels.js";

export const rawVariableIdSchema = z.enum([
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
  "geometric_vertical_velocity",
  "absolute_vorticity",
  "total_cloud_cover",
  "cloud_water_mixing_ratio",
  "ozone_mixing_ratio",
]);

export const variableIdSchema = z.enum([
  ...rawVariableIdSchema.options,
  "wind",
  "dew_point",
  "potential_temperature",
  "mixing_ratio",
  "virtual_temperature",
  "air_density",
]);
export const layerDiagnosticIdSchema = z.enum(LAYER_DIAGNOSTIC_IDS);
export const nonIsobaricFieldIdSchema = z.enum(NON_ISOBARIC_FIELD_IDS);
export const profileSourceIdSchema = z.enum(["nomads", "s3"]);

export const isoDateTimeSchema = z.string().refine(
  (value) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)),
  "Expected an ISO-8601 date-time with timezone",
);

export const runSelectorSchema = z.union([
  z.literal("latest"),
  z.literal("latest_complete"),
  isoDateTimeSchema,
]).default("latest").describe(
  "GFS model initialization time; 'latest' selects the newest run that can satisfy this query, while 'latest_complete' selects the newest run published through f384",
);

export const pressureLevelSchema = z.number().refine(
  isSupportedGfsPressureLevel,
  "Pressure level is not published by the GFS 0.25° isobaric product",
);

export const pointCoordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const pointSchema = pointCoordinateSchema.shape;

const atmosphericSelectionSchema = {
  variables: z.array(variableIdSchema).min(1).optional(),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1).optional(),
  fields: z.array(nonIsobaricFieldIdSchema).min(1).optional(),
};

function validateAtmosphericSelection(
  query: {
    variables?: unknown[] | undefined;
    pressureLevelsHpa?: unknown[] | undefined;
    fields?: unknown[] | undefined;
  },
  context: z.RefinementCtx,
): void {
  const hasVariables = query.variables !== undefined;
  const hasPressureLevels = query.pressureLevelsHpa !== undefined;
  const hasFields = query.fields !== undefined;

  if (hasVariables !== hasPressureLevels) {
    context.addIssue({
      code: "custom",
      path: hasVariables ? ["pressureLevelsHpa"] : ["variables"],
      message: "Pressure-level variables and pressureLevelsHpa must be supplied together",
    });
  }
  if (!hasVariables && !hasFields) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Request at least one pressure-level variable or non-isobaric field",
    });
  }
}

export const profileQuerySchema = z.object({
  ...pointSchema,
  run: runSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time"),
  ...atmosphericSelectionSchema,
  source: profileSourceIdSchema.default("nomads").describe("Data access path: NOMADS geographic subset or NOAA AWS byte ranges"),
}).superRefine(validateAtmosphericSelection);

export const layerDiagnosticsQuerySchema = z.object({
  ...pointSchema,
  run: runSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time"),
  lowerPressureHpa: pressureLevelSchema.describe("Lower-altitude pressure surface; must be greater than upperPressureHpa"),
  upperPressureHpa: pressureLevelSchema.describe("Upper-altitude pressure surface; must be less than lowerPressureHpa"),
  diagnostics: z.array(layerDiagnosticIdSchema).min(1),
  source: profileSourceIdSchema.default("nomads").describe("Data access path: NOMADS geographic subset or NOAA AWS byte ranges"),
}).superRefine((query, context) => {
  if (query.lowerPressureHpa <= query.upperPressureHpa) {
    context.addIssue({
      code: "custom",
      path: ["upperPressureHpa"],
      message: "lowerPressureHpa must be greater than upperPressureHpa so the layer is ordered from lower to upper altitude",
    });
  }
});

export const DEFAULT_BATCH_MAX_POINTS = 50;

export const batchPointsQuerySchema = z.object({
  points: z.array(pointCoordinateSchema).min(1).max(DEFAULT_BATCH_MAX_POINTS),
  run: runSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time shared by every requested point"),
  ...atmosphericSelectionSchema,
}).superRefine(validateAtmosphericSelection);

export const DEFAULT_TIME_SERIES_MAX_STEPS = 160;
export const GFS_TOTAL_NATIVE_FORECAST_STEPS = 209;

export const timeSeriesQuerySchema = z.object({
  ...pointSchema,
  run: runSelectorSchema,
  startTime: isoDateTimeSchema.describe("Inclusive start of requested valid-time range"),
  endTime: isoDateTimeSchema.describe("Inclusive end of requested valid-time range"),
  ...atmosphericSelectionSchema,
  source: profileSourceIdSchema.default("s3").describe("S3 is the default for multi-time access; NOMADS remains available explicitly"),
  maxSteps: z.number().int().min(1).max(GFS_TOTAL_NATIVE_FORECAST_STEPS).default(DEFAULT_TIME_SERIES_MAX_STEPS),
}).superRefine(validateAtmosphericSelection);

export const DEFAULT_AREA_MAX_GRID_POINTS = 50_000;
export const GFS_GRID_SPACING_DEG = 0.25;

export const areaSummaryQuerySchema = z.object({
  westLongitude: z.number().min(-180).max(180),
  eastLongitude: z.number().min(-180).max(180),
  southLatitude: z.number().min(-90).max(90),
  northLatitude: z.number().min(-90).max(90),
  run: runSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time"),
  variable: rawVariableIdSchema,
  pressureLevelHpa: pressureLevelSchema,
  maxGridPoints: z.number().int().min(1).max(1_100_000).default(DEFAULT_AREA_MAX_GRID_POINTS),
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
});

export type RawVariableId = z.infer<typeof rawVariableIdSchema>;
export type VariableId = z.infer<typeof variableIdSchema>;
export type LayerDiagnosticId = z.infer<typeof layerDiagnosticIdSchema>;
export type NonIsobaricFieldId = z.infer<typeof nonIsobaricFieldIdSchema>;
export type ProfileSourceId = z.infer<typeof profileSourceIdSchema>;
export type PointCoordinate = z.infer<typeof pointCoordinateSchema>;
export type ProfileQuery = z.output<typeof profileQuerySchema>;
export type ProfileQueryInput = z.input<typeof profileQuerySchema>;
export type LayerDiagnosticsQuery = z.output<typeof layerDiagnosticsQuerySchema>;
export type LayerDiagnosticsQueryInput = z.input<typeof layerDiagnosticsQuerySchema>;
export type BatchPointsQuery = z.output<typeof batchPointsQuerySchema>;
export type BatchPointsQueryInput = z.input<typeof batchPointsQuerySchema>;
export type TimeSeriesQuery = z.output<typeof timeSeriesQuerySchema>;
export type TimeSeriesQueryInput = z.input<typeof timeSeriesQuerySchema>;
export type AreaSummaryQuery = z.output<typeof areaSummaryQuerySchema>;
export type AreaSummaryQueryInput = z.input<typeof areaSummaryQuerySchema>;
