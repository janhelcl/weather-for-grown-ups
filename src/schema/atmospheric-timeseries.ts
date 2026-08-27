import * as z from "zod/v4";
import { operationalGfsModelIdSchema } from "./gfs-grid.js";
import {
  gefsEnsembleTimeSeriesQuerySchema,
  gefsEnsembleTimeSeriesResultSchema,
} from "./gefs-ensemble-timeseries.js";
import { historicalTimeSeriesQuerySchema } from "./history.js";
import { historicalTimeSeriesResultSchema } from "./history-result.js";
import { timeSeriesQuerySchema } from "./query.js";
import { timeSeriesResultSchema } from "./result.js";

export const atmosphericTimeSeriesRequestSchema = z.union([
  z.object({
    model: operationalGfsModelIdSchema,
    query: timeSeriesQuerySchema,
  }),
  z.object({
    model: z.literal("gefs_0p50"),
    query: gefsEnsembleTimeSeriesQuerySchema,
  }),
  z.object({
    model: z.literal("gfs_grid4_analysis_0p5"),
    query: historicalTimeSeriesQuerySchema,
  }),
]);

export const atmosphericTimeSeriesResultSchema = z.union([
  timeSeriesResultSchema,
  gefsEnsembleTimeSeriesResultSchema,
  historicalTimeSeriesResultSchema,
]);

export type AtmosphericTimeSeriesRequestInput = z.input<typeof atmosphericTimeSeriesRequestSchema>;
export type AtmosphericTimeSeriesResult = z.infer<typeof atmosphericTimeSeriesResultSchema>;
