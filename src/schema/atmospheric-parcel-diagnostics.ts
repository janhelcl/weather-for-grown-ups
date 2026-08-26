import * as z from "zod/v4";
import {
  gefsParcelDiagnosticsQuerySchema,
  gefsParcelDiagnosticsResultSchema,
} from "./gefs-parcel-diagnostics.js";
import {
  historicalParcelQuerySchema,
  historicalParcelResultSchema,
} from "./history-parcel.js";
import { parcelDiagnosticsQuerySchema } from "./query.js";
import { parcelDiagnosticsResultSchema } from "./result.js";

export const atmosphericParcelDiagnosticsRequestSchema = z.union([
  z.object({
    model: z.literal("gfs_0p25"),
    query: parcelDiagnosticsQuerySchema,
  }),
  z.object({
    model: z.literal("gefs_0p50"),
    query: gefsParcelDiagnosticsQuerySchema,
  }),
  z.object({
    model: z.literal("gfs_grid4_analysis_0p5"),
    query: historicalParcelQuerySchema,
  }),
]);

export const atmosphericParcelDiagnosticsResultSchema = z.union([
  parcelDiagnosticsResultSchema,
  gefsParcelDiagnosticsResultSchema,
  historicalParcelResultSchema,
]);

export type AtmosphericParcelDiagnosticsRequestInput = z.input<typeof atmosphericParcelDiagnosticsRequestSchema>;
export type AtmosphericParcelDiagnosticsResult = z.infer<typeof atmosphericParcelDiagnosticsResultSchema>;
