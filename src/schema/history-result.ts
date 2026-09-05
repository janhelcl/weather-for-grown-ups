import * as z from "zod/v4";
import {
  historicalAnalysisTimeSchema,
  historicalCycleHourUtcSchema,
  historicalGfsVariableIdSchema,
} from "./history.js";
import { gridPointSchema, profileLevelResultSchema } from "./result.js";

const historicalCaveatSchema = z.literal(
  "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
);

export const historicalAnalysisProviderSchema = z.union([
  z.literal("NOAA NCEI"),
  z.literal("NOAA AWS Open Data"),
]);

export const historicalAnalysisAccessSchema = z.union([
  z.literal("ncei_thredds_ncss"),
  z.literal("ncei_thredds_fileserver"),
  z.literal("s3_range"),
]);

export const historicalAnalysisSourceSchema = z.object({
  provider: historicalAnalysisProviderSchema,
  access: historicalAnalysisAccessSchema,
  dataset: z.string().min(1),
  cacheHit: z.boolean(),
});

export const historicalAnalysisSourceSummarySchema = z.object({
  provider: historicalAnalysisProviderSchema,
  access: historicalAnalysisAccessSchema,
});

export const historicalProfileResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  analysisTime: historicalAnalysisTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
  }),
  levels: z.array(profileLevelResultSchema).min(1),
  source: historicalAnalysisSourceSchema,
  caveat: historicalCaveatSchema,
});

export const historicalTimeSeriesResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  requestedStartTime: z.string().datetime({ offset: true }),
  requestedEndTime: z.string().datetime({ offset: true }),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
    cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1),
  }),
  source: historicalAnalysisSourceSummarySchema,
  series: z.array(z.object({
    analysisTime: historicalAnalysisTimeSchema,
    levels: z.array(profileLevelResultSchema).min(1),
    dataset: z.string().min(1),
    cacheHit: z.boolean(),
  })).min(1),
  caveat: historicalCaveatSchema,
});

export type HistoricalProfileResult = z.infer<typeof historicalProfileResultSchema>;
export type HistoricalTimeSeriesResult = z.infer<typeof historicalTimeSeriesResultSchema>;
