import * as z from "zod/v4";
import { isSupportedGfsPressureLevel } from "../catalog/pressure-levels.js";

export const variableIdSchema = z.enum([
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
  "wind",
]);

export const profileSourceIdSchema = z.enum(["nomads", "s3"]);

export const isoDateTimeSchema = z.string().refine(
  (value) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)),
  "Expected an ISO-8601 date-time with timezone",
);

export const runSelectorSchema = z.union([
  z.literal("latest"),
  isoDateTimeSchema,
]).default("latest").describe("GFS model initialization time, or 'latest' for the latest complete cycle");

export const pressureLevelSchema = z.number().refine(
  isSupportedGfsPressureLevel,
  "Pressure level is not published by the GFS 0.25° isobaric product",
);

const pointSchema = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
};

const atmosphericSelectionSchema = {
  variables: z.array(variableIdSchema).min(1),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1),
};

export const profileQuerySchema = z.object({
  ...pointSchema,
  run: runSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time"),
  ...atmosphericSelectionSchema,
  source: profileSourceIdSchema.default("nomads").describe("Data access path: NOMADS geographic subset or NOAA AWS byte ranges"),
});

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
});

export type VariableId = z.infer<typeof variableIdSchema>;
export type ProfileSourceId = z.infer<typeof profileSourceIdSchema>;
export type ProfileQuery = z.output<typeof profileQuerySchema>;
export type ProfileQueryInput = z.input<typeof profileQuerySchema>;
export type TimeSeriesQuery = z.output<typeof timeSeriesQuerySchema>;
export type TimeSeriesQueryInput = z.input<typeof timeSeriesQuerySchema>;
