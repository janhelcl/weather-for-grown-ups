import * as z from "zod/v4";
import {
  historicalAnalysisSourceSummarySchema,
} from "./history-result.js";
import { diagnosticTimeSeriesSelectionSchema } from "./diagnostic-time-series.js";
import { compactParcelComputationSchema } from "./diagnostic-time-series-result.js";
import {
  DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS,
  HISTORICAL_GFS_CYCLE_HOURS_UTC,
  MAX_HISTORICAL_TIME_SERIES_MAX_STEPS,
  historicalAnalysisTimeSchema,
  historicalCycleHourUtcSchema,
} from "./history.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";
import {
  gridPointSchema,
  layerDiagnosticResultSchema,
  profileDiagnosticResultSchema,
} from "./result.js";

export const historicalDiagnosticTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  startTime: isoDateTimeSchema.describe("Inclusive start of historical analysis range"),
  endTime: isoDateTimeSchema.describe("Inclusive end of historical analysis range"),
  diagnostic: diagnosticTimeSeriesSelectionSchema,
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema)
    .min(1)
    .max(HISTORICAL_GFS_CYCLE_HOURS_UTC.length)
    .default([...HISTORICAL_GFS_CYCLE_HOURS_UTC]),
  maxSteps: z.number().int().min(1).max(MAX_HISTORICAL_TIME_SERIES_MAX_STEPS)
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

const historicalDiagnosticSourceSchema = historicalAnalysisSourceSummarySchema;

const commonStepShape = {
  analysisTime: historicalAnalysisTimeSchema,
  dataset: z.string().min(1),
  cacheHit: z.boolean(),
};

const historicalLayerStepSchema = z.object({
  kind: z.literal("layer"),
  ...commonStepShape,
  layer: z.object({
    lowerPressureHpa: z.number(),
    upperPressureHpa: z.number(),
    lowerGeopotentialHeightGpm: z.number(),
    upperGeopotentialHeightGpm: z.number(),
    depthGpm: z.number().positive(),
  }),
  diagnostics: z.array(layerDiagnosticResultSchema).min(1),
});

const historicalProfileStepSchema = z.object({
  kind: z.literal("profile"),
  ...commonStepShape,
  diagnostics: z.array(profileDiagnosticResultSchema).min(1),
});

const historicalParcelStepSchema = z.object({
  kind: z.literal("parcel"),
  ...commonStepShape,
  parcel: compactParcelComputationSchema,
});

export const historicalDiagnosticTimeSeriesStepSchema = z.discriminatedUnion("kind", [
  historicalLayerStepSchema,
  historicalProfileStepSchema,
  historicalParcelStepSchema,
]);

export const historicalDiagnosticTimeSeriesResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  diagnostic: diagnosticTimeSeriesSelectionSchema,
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1),
  source: historicalDiagnosticSourceSchema,
  series: z.array(historicalDiagnosticTimeSeriesStepSchema).min(1),
  caveat: z.literal(
    "Diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis",
  ),
});

export type HistoricalDiagnosticTimeSeriesQueryInput = z.input<typeof historicalDiagnosticTimeSeriesQuerySchema>;
export type HistoricalDiagnosticTimeSeriesResult = z.infer<typeof historicalDiagnosticTimeSeriesResultSchema>;
export type HistoricalDiagnosticTimeSeriesStep = z.infer<typeof historicalDiagnosticTimeSeriesStepSchema>;
