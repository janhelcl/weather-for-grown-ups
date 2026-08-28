import * as z from "zod/v4";
import { LAYER_DIAGNOSTIC_IDS } from "../catalog/layer-diagnostics.js";
import { PARCEL_DEFINITION_IDS } from "../catalog/parcel-diagnostics.js";
import { PROFILE_DIAGNOSTIC_IDS } from "../catalog/profile-diagnostics.js";
import { diagnosticTimeSeriesStepSchema } from "./diagnostic-time-series-result.js";
import {
  ifsPressureLevelSchema,
  ifsProfileResultSchema,
  ifsRunSelectorSchema,
} from "./ifs.js";
import {
  IFS_DEFAULT_TIME_SERIES_MAX_STEPS,
  IFS_MAX_NATIVE_STEPS,
} from "./ifs-spatiotemporal.js";
import { gridPointSchema } from "./result.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const ifsDiagnosticTimeSeriesSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("layer"),
    lowerPressureHpa: ifsPressureLevelSchema,
    upperPressureHpa: ifsPressureLevelSchema,
    diagnostics: z.array(z.enum(LAYER_DIAGNOSTIC_IDS)).min(1),
  }),
  z.object({
    kind: z.literal("profile"),
    pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2).max(14),
    diagnostics: z.array(z.enum(PROFILE_DIAGNOSTIC_IDS)).min(1),
  }),
  z.object({
    kind: z.literal("parcel"),
    pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2).max(14),
    parcel: z.enum(PARCEL_DEFINITION_IDS),
  }),
]);

export const ifsDiagnosticTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  diagnostic: ifsDiagnosticTimeSeriesSelectionSchema,
  maxSteps: z.number().int().min(1).max(IFS_MAX_NATIVE_STEPS).default(IFS_DEFAULT_TIME_SERIES_MAX_STEPS),
}).superRefine((query, context) => {
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "endTime must be at or after startTime",
    });
  }

  switch (query.diagnostic.kind) {
    case "layer":
      if (query.diagnostic.lowerPressureHpa <= query.diagnostic.upperPressureHpa) {
        context.addIssue({
          code: "custom",
          path: ["diagnostic", "upperPressureHpa"],
          message: "lowerPressureHpa must be greater than upperPressureHpa so the layer is ordered from lower to upper altitude",
        });
      }
      if (new Set(query.diagnostic.diagnostics).size !== query.diagnostic.diagnostics.length) {
        context.addIssue({
          code: "custom",
          path: ["diagnostic", "diagnostics"],
          message: "IFS layer diagnostic time-series selection must not contain duplicates",
        });
      }
      break;
    case "profile":
      if (new Set(query.diagnostic.pressureLevelsHpa).size !== query.diagnostic.pressureLevelsHpa.length) {
        context.addIssue({
          code: "custom",
          path: ["diagnostic", "pressureLevelsHpa"],
          message: "IFS profile diagnostic time-series pressure levels must not contain duplicates",
        });
      }
      if (new Set(query.diagnostic.diagnostics).size !== query.diagnostic.diagnostics.length) {
        context.addIssue({
          code: "custom",
          path: ["diagnostic", "diagnostics"],
          message: "IFS profile diagnostic time-series selection must not contain duplicates",
        });
      }
      break;
    case "parcel":
      if (new Set(query.diagnostic.pressureLevelsHpa).size !== query.diagnostic.pressureLevelsHpa.length) {
        context.addIssue({
          code: "custom",
          path: ["diagnostic", "pressureLevelsHpa"],
          message: "IFS parcel diagnostic time-series pressure levels must not contain duplicates",
        });
      }
      break;
  }
});

const ifsTimeSeriesSourceSchema = ifsProfileResultSchema.shape.source.omit({ cacheHit: true });

export const ifsDiagnosticTimeSeriesResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  run: isoDateTimeSchema,
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  source: ifsTimeSeriesSourceSchema,
  diagnostic: ifsDiagnosticTimeSeriesSelectionSchema,
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

export type IfsDiagnosticTimeSeriesSelection = z.output<typeof ifsDiagnosticTimeSeriesSelectionSchema>;
export type IfsDiagnosticTimeSeriesQueryInput = z.input<typeof ifsDiagnosticTimeSeriesQuerySchema>;
export type IfsDiagnosticTimeSeriesResult = z.infer<typeof ifsDiagnosticTimeSeriesResultSchema>;
