import * as z from "zod/v4";
import { GEFS_MEMBERS } from "../catalog/gefs.js";
import { GEFS_TOTAL_NATIVE_FORECAST_STEPS } from "../core/gefs-time.js";
import { gefsMemberSchema, gefsRunSelectorSchema } from "./gefs-ensemble.js";
import { gefsLayerDiagnosticsQuerySchema, gefsLayerDiagnosticsResultSchema } from "./gefs-layer-diagnostics.js";
import {
  gefsProfileDiagnosticsQuerySchema,
  gefsProfileDiagnosticSummarySchema,
} from "./gefs-profile-diagnostics.js";
import {
  isoDateTimeSchema,
  layerDiagnosticIdSchema,
  pointCoordinateSchema,
  profileDiagnosticIdSchema,
} from "./query.js";

export const GEFS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS = 40;

export const gefsDiagnosticTimeSeriesSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("layer"),
    lowerPressureHpa: z.number().positive(),
    upperPressureHpa: z.number().positive(),
    diagnostics: z.array(layerDiagnosticIdSchema).min(1),
  }),
  z.object({
    kind: z.literal("profile"),
    pressureLevelsHpa: z.array(z.number().positive()).min(2).max(12),
    diagnostics: z.array(profileDiagnosticIdSchema).min(1),
  }),
]);

export const gefsDiagnosticTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: gefsRunSelectorSchema,
  startTime: isoDateTimeSchema.describe("Inclusive first native three-hour GEFS valid time"),
  endTime: isoDateTimeSchema.describe("Inclusive last native three-hour GEFS valid time"),
  diagnostic: gefsDiagnosticTimeSeriesSelectionSchema,
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  maxSteps: z.number().int().min(1).max(GEFS_TOTAL_NATIVE_FORECAST_STEPS).default(GEFS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS),
}).superRefine((query, context) => {
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be at or after startTime" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }

  const common = {
    latitude: query.latitude,
    longitude: query.longitude,
    run: query.run,
    validTime: query.startTime,
    members: query.members,
    quantiles: query.quantiles,
    includeMembers: false,
  };
  const validated = query.diagnostic.kind === "layer"
    ? gefsLayerDiagnosticsQuerySchema.safeParse({ ...common, ...query.diagnostic })
    : gefsProfileDiagnosticsQuerySchema.safeParse({ ...common, ...query.diagnostic });
  if (!validated.success) {
    for (const issue of validated.error.issues) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic", ...issue.path.filter((part) => !["latitude", "longitude", "run", "validTime", "members", "quantiles", "includeMembers"].includes(String(part)))],
        message: issue.message,
      });
    }
  }
});

const layerStepSchema = z.object({
  kind: z.literal("layer"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  pressureLayer: gefsLayerDiagnosticsResultSchema.shape.pressureLayer,
  layerDepthGpm: gefsLayerDiagnosticsResultSchema.shape.layerDepthGpm,
  summaries: gefsLayerDiagnosticsResultSchema.shape.summaries,
  allCacheHit: z.boolean(),
});

const profileStepSchema = z.object({
  kind: z.literal("profile"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  sampledPressureLevelsHpa: z.array(z.number().positive()).min(2),
  summaries: z.array(gefsProfileDiagnosticSummarySchema).min(1),
  allCacheHit: z.boolean(),
});

export const gefsDiagnosticTimeSeriesStepSchema = z.discriminatedUnion("kind", [
  layerStepSchema,
  profileStepSchema,
]);

export const gefsDiagnosticTimeSeriesResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  stepHours: z.literal(3),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  selection: z.object({
    diagnostic: gefsDiagnosticTimeSeriesSelectionSchema,
    members: z.array(gefsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  series: z.array(gefsDiagnosticTimeSeriesStepSchema).min(1).max(GEFS_TOTAL_NATIVE_FORECAST_STEPS),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
}).superRefine((value, context) => {
  for (const [index, step] of value.series.entries()) {
    if (step.kind !== value.selection.diagnostic.kind) {
      context.addIssue({
        code: "custom",
        path: ["series", index, "kind"],
        message: `GEFS diagnostic time-series step kind ${step.kind} does not match selection kind ${value.selection.diagnostic.kind}`,
      });
    }
  }
});

export type GefsDiagnosticTimeSeriesSelection = z.output<typeof gefsDiagnosticTimeSeriesSelectionSchema>;
export type GefsDiagnosticTimeSeriesQueryInput = z.input<typeof gefsDiagnosticTimeSeriesQuerySchema>;
export type GefsDiagnosticTimeSeriesResult = z.infer<typeof gefsDiagnosticTimeSeriesResultSchema>;
export type GefsDiagnosticTimeSeriesStep = z.infer<typeof gefsDiagnosticTimeSeriesStepSchema>;
