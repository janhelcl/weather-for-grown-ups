import * as z from "zod/v4";
import { operationalGfsModelIdSchema } from "./gfs-grid.js";
import { gefsEnsembleProfileQuerySchema, gefsEnsembleProfileResultSchema } from "./gefs-ensemble-profile.js";
import { historicalProfileQuerySchema } from "./history.js";
import { historicalProfileResultSchema } from "./history-result.js";
import { profileQuerySchema } from "./query.js";
import { profileResultSchema } from "./result.js";

export const atmosphericModelIdSchema = z.enum([
  "gfs_0p25",
  "gfs_0p50",
  "gefs_0p50",
  "gfs_grid4_analysis_0p5",
]);

export const atmosphericProfileRequestSchema = z.union([
  z.object({
    model: operationalGfsModelIdSchema,
    query: profileQuerySchema,
  }),
  z.object({
    model: z.literal("gefs_0p50"),
    query: gefsEnsembleProfileQuerySchema,
  }),
  z.object({
    model: z.literal("gfs_grid4_analysis_0p5"),
    query: historicalProfileQuerySchema,
  }),
]);

export const atmosphericProfileResultSchema = z.union([
  profileResultSchema,
  gefsEnsembleProfileResultSchema,
  historicalProfileResultSchema,
]);

export type AtmosphericProfileRequestInput = z.input<typeof atmosphericProfileRequestSchema>;
export type AtmosphericProfileRequest = z.infer<typeof atmosphericProfileRequestSchema>;
export type AtmosphericProfileResult = z.infer<typeof atmosphericProfileResultSchema>;
