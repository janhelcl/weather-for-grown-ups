import * as z from "zod/v4";
import {
  gefsLayerDiagnosticsQuerySchema,
  gefsLayerDiagnosticsResultSchema,
} from "./gefs-layer-diagnostics.js";
import {
  historicalLayerDiagnosticsQuerySchema,
  historicalLayerDiagnosticsResultSchema,
} from "./history-diagnostics.js";
import { layerDiagnosticsQuerySchema } from "./query.js";
import { layerDiagnosticsResultSchema } from "./result.js";

export const atmosphericLayerDiagnosticsRequestSchema = z.union([
  z.object({
    model: z.literal("gfs_0p25"),
    query: layerDiagnosticsQuerySchema,
  }),
  z.object({
    model: z.literal("gefs_0p50"),
    query: gefsLayerDiagnosticsQuerySchema,
  }),
  z.object({
    model: z.literal("gfs_grid4_analysis_0p5"),
    query: historicalLayerDiagnosticsQuerySchema,
  }),
]);

export const atmosphericLayerDiagnosticsResultSchema = z.union([
  layerDiagnosticsResultSchema,
  gefsLayerDiagnosticsResultSchema,
  historicalLayerDiagnosticsResultSchema,
]);

export type AtmosphericLayerDiagnosticsRequestInput = z.input<typeof atmosphericLayerDiagnosticsRequestSchema>;
export type AtmosphericLayerDiagnosticsResult = z.infer<typeof atmosphericLayerDiagnosticsResultSchema>;
