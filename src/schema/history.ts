import * as z from "zod/v4";
import { isoDateTimeSchema, pressureLevelSchema, pointCoordinateSchema } from "./query.js";

export const HISTORICAL_GFS_VARIABLE_IDS = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
  "absolute_vorticity",
  "cloud_water_mixing_ratio",
  "ozone_mixing_ratio",
  "wind",
  "dew_point",
  "potential_temperature",
  "mixing_ratio",
  "virtual_temperature",
  "air_density",
  "wet_bulb_temperature",
  "equivalent_potential_temperature",
] as const;

export const historicalGfsVariableIdSchema = z.enum(HISTORICAL_GFS_VARIABLE_IDS);

export const HISTORICAL_GFS_CYCLE_HOURS_UTC = [0, 6, 12, 18] as const;
export const historicalCycleHourUtcSchema = z.union([
  z.literal(0),
  z.literal(6),
  z.literal(12),
  z.literal(18),
]);

export const historicalAnalysisTimeSchema = z.string().refine((value) => {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const date = new Date(value);
  return date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0
    && HISTORICAL_GFS_CYCLE_HOURS_UTC.includes(date.getUTCHours() as 0 | 6 | 12 | 18);
}, "Expected an exact GFS analysis cycle at 00, 06, 12, or 18 UTC");

export const historicalProfileQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  analysisTime: historicalAnalysisTimeSchema.describe(
    "Historical GFS Grid 4 analysis cycle. The online NCEI archive begins in 2007; this is model analysis, not an observation or homogeneous climatological reanalysis.",
  ),
  variables: z.array(historicalGfsVariableIdSchema).min(1),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1),
});

export const DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS = 8;
export const MAX_HISTORICAL_TIME_SERIES_MAX_STEPS = 16;

export const historicalTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  startTime: isoDateTimeSchema.describe("Inclusive start of the historical analysis range"),
  endTime: isoDateTimeSchema.describe("Inclusive end of the historical analysis range"),
  variables: z.array(historicalGfsVariableIdSchema).min(1),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1),
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema)
    .min(1)
    .max(HISTORICAL_GFS_CYCLE_HOURS_UTC.length)
    .default([...HISTORICAL_GFS_CYCLE_HOURS_UTC])
    .describe("UTC GFS analysis cycles to sample within the range; select a subset such as [12] for sparse daily sampling"),
  maxSteps: z.number()
    .int()
    .min(1)
    .max(MAX_HISTORICAL_TIME_SERIES_MAX_STEPS)
    .default(DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS),
}).superRefine((query, context) => {
  if (new Date(query.startTime) > new Date(query.endTime)) {
    context.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "endTime must be greater than or equal to startTime",
    });
  }
  if (new Set(query.cycleHoursUtc).size !== query.cycleHoursUtc.length) {
    context.addIssue({
      code: "custom",
      path: ["cycleHoursUtc"],
      message: "cycleHoursUtc must not contain duplicates",
    });
  }
});

export type HistoricalGfsVariableId = z.infer<typeof historicalGfsVariableIdSchema>;
export type HistoricalCycleHourUtc = z.infer<typeof historicalCycleHourUtcSchema>;
export type HistoricalProfileQuery = z.output<typeof historicalProfileQuerySchema>;
export type HistoricalProfileQueryInput = z.input<typeof historicalProfileQuerySchema>;
export type HistoricalTimeSeriesQuery = z.output<typeof historicalTimeSeriesQuerySchema>;
export type HistoricalTimeSeriesQueryInput = z.input<typeof historicalTimeSeriesQuerySchema>;
