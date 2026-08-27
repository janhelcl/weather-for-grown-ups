import * as z from "zod/v4";
import { operationalGfsModelIdSchema } from "./gfs-grid.js";
import {
  gefsProfileDiagnosticsQuerySchema,
  gefsProfileDiagnosticsResultSchema,
} from "./gefs-profile-diagnostics.js";
import {
  historicalProfileDiagnosticsQuerySchema,
  historicalProfileDiagnosticsResultSchema,
} from "./history-diagnostics.js";
import { profileDiagnosticsQuerySchema } from "./query.js";
import { profileDiagnosticsResultSchema } from "./result.js";

export const atmosphericProfileDiagnosticsRequestSchema = z.union([
  z.object({
    model: operationalGfsModelIdSchema,
    query: profileDiagnosticsQuerySchema,
  }),
  z.object({
    model: z.literal("gefs_0p50"),
    query: gefsProfileDiagnosticsQuerySchema,
  }),
  z.object({
    model: z.literal("gfs_grid4_analysis_0p5"),
    query: historicalProfileDiagnosticsQuerySchema,
  }),
]);

export const atmosphericProfileDiagnosticsResultSchema = z.union([
  profileDiagnosticsResultSchema,
  gefsProfileDiagnosticsResultSchema,
  historicalProfileDiagnosticsResultSchema,
]);

export type AtmosphericProfileDiagnosticsRequestInput = z.input<typeof atmosphericProfileDiagnosticsRequestSchema>;
export type AtmosphericProfileDiagnosticsResult = z.infer<typeof atmosphericProfileDiagnosticsResultSchema>;
