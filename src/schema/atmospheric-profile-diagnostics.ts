import * as z from "zod/v4";
import {
  gefsProfileDiagnosticsQuerySchema,
  gefsProfileDiagnosticsResultSchema,
} from "./gefs-profile-diagnostics.js";
import { profileDiagnosticsQuerySchema } from "./query.js";
import { profileDiagnosticsResultSchema } from "./result.js";

export const atmosphericProfileDiagnosticsRequestSchema = z.union([
  z.object({
    model: z.literal("gfs_0p25"),
    query: profileDiagnosticsQuerySchema,
  }),
  z.object({
    model: z.literal("gefs_0p50"),
    query: gefsProfileDiagnosticsQuerySchema,
  }),
]);

export const atmosphericProfileDiagnosticsResultSchema = z.union([
  profileDiagnosticsResultSchema,
  gefsProfileDiagnosticsResultSchema,
]);

export type AtmosphericProfileDiagnosticsRequestInput = z.input<typeof atmosphericProfileDiagnosticsRequestSchema>;
export type AtmosphericProfileDiagnosticsResult = z.infer<typeof atmosphericProfileDiagnosticsResultSchema>;
