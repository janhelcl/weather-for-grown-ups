import * as z from "zod/v4";
import { operationalGfsModelIdSchema } from "./gfs-grid.js";
import { isoDateTimeSchema, nonIsobaricFieldIdSchema } from "./query.js";
import {
  gridPointSchema,
  nonIsobaricFieldResultSchema,
  profileLevelResultSchema,
} from "./result.js";

export const runComparisonNumericChangeSchema = z.object({
  field: z.string(),
  from: z.number(),
  to: z.number(),
  delta: z.number(),
  deltaKind: z.enum(["linear", "circular_degrees"]),
});

export const runComparisonPressureLevelChangeSchema = z.object({
  pressureHpa: z.number().positive(),
  changes: z.array(runComparisonNumericChangeSchema),
});

export const runComparisonFieldChangeSchema = z.object({
  id: nonIsobaricFieldIdSchema,
  comparable: z.boolean(),
  reason: z.enum([
    "field_missing_in_one_run",
    "vertical_semantics_differ",
    "temporal_windows_differ",
  ]).optional(),
  changes: z.array(runComparisonNumericChangeSchema),
}).superRefine((value, context) => {
  if (value.comparable && value.reason !== undefined) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Comparable fields must not include an incompatibility reason" });
  }
  if (!value.comparable && value.reason === undefined) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Non-comparable fields must include an incompatibility reason" });
  }
  if (!value.comparable && value.changes.length > 0) {
    context.addIssue({ code: "custom", path: ["changes"], message: "Non-comparable fields must not include numeric deltas" });
  }
});

export const runComparisonSnapshotSchema = z.object({
  run: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  levels: z.array(profileLevelResultSchema),
  fields: z.array(nonIsobaricFieldResultSchema).optional(),
  cacheHit: z.boolean(),
});

export const runComparisonTransitionSchema = z.object({
  fromRun: isoDateTimeSchema,
  toRun: isoDateTimeSchema,
  fromForecastHour: z.number().int().min(0).max(384),
  toForecastHour: z.number().int().min(0).max(384),
  pressureLevels: z.array(runComparisonPressureLevelChangeSchema),
  fields: z.array(runComparisonFieldChangeSchema),
});

export const runComparisonResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  validTime: isoDateTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  anchorRun: isoDateTimeSchema,
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
  }),
  runs: z.array(runComparisonSnapshotSchema).min(2).max(6),
  comparisons: z.array(runComparisonTransitionSchema).min(1).max(5),
}).superRefine((value, context) => {
  if (value.comparisons.length !== value.runs.length - 1) {
    context.addIssue({ code: "custom", path: ["comparisons"], message: "Run comparison must contain one transition between each consecutive pair of runs" });
  }
  if (value.runs.at(-1)?.run !== value.anchorRun) {
    context.addIssue({ code: "custom", path: ["anchorRun"], message: "anchorRun must equal the newest returned run" });
  }
});

export type RunComparisonResultContract = z.infer<typeof runComparisonResultSchema>;
