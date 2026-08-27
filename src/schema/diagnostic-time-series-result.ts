import * as z from "zod/v4";
import { diagnosticTimeSeriesSelectionSchema } from "./diagnostic-time-series.js";
import { operationalGfsModelIdSchema } from "./gfs-grid.js";
import { isoDateTimeSchema } from "./query.js";
import {
  gridPointSchema,
  layerDiagnosticResultSchema,
  parcelComputationSchema,
  profileDiagnosticResultSchema,
  sourceProvenanceSchema,
} from "./result.js";

const layerStepSchema = z.object({
  kind: z.literal("layer"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  layer: z.object({
    lowerPressureHpa: z.number(),
    upperPressureHpa: z.number(),
    lowerGeopotentialHeightGpm: z.number(),
    upperGeopotentialHeightGpm: z.number(),
    depthGpm: z.number().positive(),
  }),
  diagnostics: z.array(layerDiagnosticResultSchema).min(1),
  cacheHit: z.boolean(),
});

const profileStepSchema = z.object({
  kind: z.literal("profile"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  diagnostics: z.array(profileDiagnosticResultSchema).min(1),
  cacheHit: z.boolean(),
});

export const compactParcelComputationSchema = parcelComputationSchema.omit({ parcelPath: true });

const parcelStepSchema = z.object({
  kind: z.literal("parcel"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  parcel: compactParcelComputationSchema,
  cacheHit: z.boolean(),
});

export const diagnosticTimeSeriesStepSchema = z.discriminatedUnion("kind", [
  layerStepSchema,
  profileStepSchema,
  parcelStepSchema,
]);

export const diagnosticTimeSeriesResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  source: sourceProvenanceSchema,
  diagnostic: diagnosticTimeSeriesSelectionSchema,
  series: z.array(diagnosticTimeSeriesStepSchema).min(1),
}).superRefine((value, context) => {
  for (const [index, step] of value.series.entries()) {
    if (step.kind !== value.diagnostic.kind) {
      context.addIssue({
        code: "custom",
        path: ["series", index, "kind"],
        message: `Diagnostic time-series step kind ${step.kind} does not match selection kind ${value.diagnostic.kind}`,
      });
    }
  }
});

export type DiagnosticTimeSeriesStep = z.output<typeof diagnosticTimeSeriesStepSchema>;
export type DiagnosticTimeSeriesResult = z.output<typeof diagnosticTimeSeriesResultSchema>;
