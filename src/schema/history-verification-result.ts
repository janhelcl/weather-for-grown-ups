import * as z from "zod/v4";
import { historicalAnalysisTimeSchema, historicalGfsVariableIdSchema } from "./history.js";
import { historicalVerificationLeadHoursSchema } from "./history-verification.js";
import { gridPointSchema, profileLevelResultSchema } from "./result.js";

const numericChangeSchema = z.object({
  field: z.string().min(1),
  forecast: z.number(),
  analysis: z.number(),
  delta: z.number(),
  deltaKind: z.enum(["linear", "circular_degrees"]),
});

export const historicalForecastVerificationResultSchema = z.object({
  model: z.literal("gfs_grid4_archive_verification_0p5"),
  validTime: historicalAnalysisTimeSchema,
  leadHours: historicalVerificationLeadHoursSchema,
  forecastRun: historicalAnalysisTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
  }),
  comparison: z.literal("analysis_minus_forecast"),
  forecast: z.object({
    model: z.literal("gfs_grid4_forecast_0p5_archive"),
    runTime: historicalAnalysisTimeSchema,
    forecastHour: historicalVerificationLeadHoursSchema,
    validTime: historicalAnalysisTimeSchema,
    levels: z.array(profileLevelResultSchema).min(1),
    dataset: z.string().min(1),
    cacheHit: z.boolean(),
  }),
  analysis: z.object({
    model: z.literal("gfs_grid4_analysis_0p5"),
    analysisTime: historicalAnalysisTimeSchema,
    levels: z.array(profileLevelResultSchema).min(1),
    dataset: z.string().min(1),
    cacheHit: z.boolean(),
  }),
  pressureLevels: z.array(z.object({
    pressureHpa: z.number().positive(),
    changes: z.array(numericChangeSchema),
  })).min(1),
  source: z.object({
    provider: z.literal("NOAA NCEI"),
    access: z.literal("ncei_thredds_ncss"),
    forecastArchiveAvailability: z.literal(
      "online availability varies; older forecast data may require NCEI HAS",
    ),
  }),
  caveat: z.literal(
    "Forecast verification against GFS model analysis, not direct observations; historical GFS model versions changed over time",
  ),
});

export type HistoricalForecastVerificationResult = z.infer<typeof historicalForecastVerificationResultSchema>;
