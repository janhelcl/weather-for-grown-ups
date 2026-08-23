import * as z from "zod/v4";
import {
  gefsLayerDiagnosticsQuerySchema,
  gefsLayerDiagnosticsResultSchema,
} from "./gefs-layer-diagnostics.js";
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
]);

export const atmosphericLayerDiagnosticsResultSchema = z.union([
  layerDiagnosticsResultSchema,
  gefsLayerDiagnosticsResultSchema,
]);

export type AtmosphericLayerDiagnosticsRequestInput = z.input<typeof atmosphericLayerDiagnosticsRequestSchema>;
export type AtmosphericLayerDiagnosticsResult = z.infer<typeof atmosphericLayerDiagnosticsResultSchema>;
