import * as z from "zod/v4";
import { gefsEnsembleProfileQuerySchema, gefsEnsembleProfileResultSchema } from "./gefs-ensemble-profile.js";
import { profileQuerySchema } from "./query.js";
import { profileResultSchema } from "./result.js";

export const atmosphericModelIdSchema = z.enum(["gfs_0p25", "gefs_0p50"]);

export const atmosphericProfileRequestSchema = z.union([
  z.object({
    model: z.literal("gfs_0p25"),
    query: profileQuerySchema,
  }),
  z.object({
    model: z.literal("gefs_0p50"),
    query: gefsEnsembleProfileQuerySchema,
  }),
]);

export const atmosphericProfileResultSchema = z.union([
  profileResultSchema,
  gefsEnsembleProfileResultSchema,
]);

export type AtmosphericProfileRequestInput = z.input<typeof atmosphericProfileRequestSchema>;
export type AtmosphericProfileRequest = z.infer<typeof atmosphericProfileRequestSchema>;
export type AtmosphericProfileResult = z.infer<typeof atmosphericProfileResultSchema>;
