import * as z from "zod/v4";
import {
  gefsEnsembleTimeSeriesQuerySchema,
  gefsEnsembleTimeSeriesResultSchema,
} from "./gefs-ensemble-timeseries.js";
import { timeSeriesQuerySchema } from "./query.js";
import { timeSeriesResultSchema } from "./result.js";

export const atmosphericTimeSeriesRequestSchema = z.union([
  z.object({
    model: z.literal("gfs_0p25"),
    query: timeSeriesQuerySchema,
  }),
  z.object({
    model: z.literal("gefs_0p50"),
    query: gefsEnsembleTimeSeriesQuerySchema,
  }),
]);

export const atmosphericTimeSeriesResultSchema = z.union([
  timeSeriesResultSchema,
  gefsEnsembleTimeSeriesResultSchema,
]);

export type AtmosphericTimeSeriesRequestInput = z.input<typeof atmosphericTimeSeriesRequestSchema>;
export type AtmosphericTimeSeriesResult = z.infer<typeof atmosphericTimeSeriesResultSchema>;
