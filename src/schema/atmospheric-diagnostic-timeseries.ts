import * as z from "zod/v4";
import { diagnosticTimeSeriesQuerySchema } from "./diagnostic-time-series.js";
import { diagnosticTimeSeriesResultSchema } from "./diagnostic-time-series-result.js";
import {
  gefsDiagnosticTimeSeriesQuerySchema,
  gefsDiagnosticTimeSeriesResultSchema,
} from "./gefs-diagnostic-timeseries.js";
import {
  historicalDiagnosticTimeSeriesQuerySchema,
  historicalDiagnosticTimeSeriesResultSchema,
} from "./history-diagnostic-timeseries.js";

export const atmosphericDiagnosticTimeSeriesRequestSchema = z.union([
  z.object({
    model: z.literal("gfs_0p25"),
    query: diagnosticTimeSeriesQuerySchema,
  }),
  z.object({
    model: z.literal("gefs_0p50"),
    query: gefsDiagnosticTimeSeriesQuerySchema,
  }),
  z.object({
    model: z.literal("gfs_grid4_analysis_0p5"),
    query: historicalDiagnosticTimeSeriesQuerySchema,
  }),
]);

export const atmosphericDiagnosticTimeSeriesResultSchema = z.union([
  diagnosticTimeSeriesResultSchema,
  gefsDiagnosticTimeSeriesResultSchema,
  historicalDiagnosticTimeSeriesResultSchema,
]);

export type AtmosphericDiagnosticTimeSeriesRequestInput = z.input<typeof atmosphericDiagnosticTimeSeriesRequestSchema>;
export type AtmosphericDiagnosticTimeSeriesResult = z.infer<typeof atmosphericDiagnosticTimeSeriesResultSchema>;
