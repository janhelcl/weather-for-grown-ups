import * as z from "zod/v4";
import { LAYER_DIAGNOSTIC_IDS, expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { PROFILE_DIAGNOSTIC_IDS, expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import { PARCEL_DEFINITION_IDS, PARCEL_DIAGNOSTIC_CATALOG } from "../catalog/parcel-diagnostics.js";
import { IFS_RAW_PRESSURE_VARIABLE_IDS } from "../catalog/ifs.js";
import {
  gridPointSchema,
  layerDiagnosticResultSchema,
  parcelComputationSchema,
  profileDiagnosticResultSchema,
  profileLevelResultSchema,
} from "./result.js";
import {
  ifsPressureLevelSchema,
  ifsProfileResultSchema,
  ifsRunSelectorSchema,
} from "./ifs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const ifsLayerDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema,
  lowerPressureHpa: ifsPressureLevelSchema,
  upperPressureHpa: ifsPressureLevelSchema,
  diagnostics: z.array(z.enum(LAYER_DIAGNOSTIC_IDS)).min(1),
}).superRefine((query, context) => {
  if (query.lowerPressureHpa <= query.upperPressureHpa) {
    context.addIssue({
      code: "custom",
      path: ["upperPressureHpa"],
      message: "lowerPressureHpa must be greater than upperPressureHpa so the layer is ordered from lower to upper altitude",
    });
  }
  if (new Set(query.diagnostics).size !== query.diagnostics.length) {
    context.addIssue({
      code: "custom",
      path: ["diagnostics"],
      message: "IFS layer diagnostic selection must not contain duplicates",
    });
  }
  validateIfsDiagnosticVariables(expandLayerDiagnosticVariables(query.diagnostics), context);
});

export const ifsProfileDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema,
  pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2).max(14),
  diagnostics: z.array(z.enum(PROFILE_DIAGNOSTIC_IDS)).min(1),
}).superRefine((query, context) => {
  if (new Set(query.pressureLevelsHpa).size !== query.pressureLevelsHpa.length) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelsHpa"],
      message: "IFS profile diagnostic pressure levels must not contain duplicates",
    });
  }
  if (new Set(query.diagnostics).size !== query.diagnostics.length) {
    context.addIssue({
      code: "custom",
      path: ["diagnostics"],
      message: "IFS profile diagnostic selection must not contain duplicates",
    });
  }
  validateIfsDiagnosticVariables(expandProfileDiagnosticVariables(query.diagnostics), context);
});

export const ifsParcelDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema,
  pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2).max(14),
  parcel: z.enum(PARCEL_DEFINITION_IDS),
}).superRefine((query, context) => {
  if (new Set(query.pressureLevelsHpa).size !== query.pressureLevelsHpa.length) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelsHpa"],
      message: "IFS parcel diagnostic pressure levels must not contain duplicates",
    });
  }
  validateIfsDiagnosticVariables(PARCEL_DIAGNOSTIC_CATALOG[query.parcel].pressureDependencies, context);
});

const ifsDiagnosticSourceSchema = ifsProfileResultSchema.shape.source;

export const ifsLayerDiagnosticsResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(240),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  layer: z.object({
    lowerPressureHpa: z.number(),
    upperPressureHpa: z.number(),
    lowerGeopotentialHeightGpm: z.number(),
    upperGeopotentialHeightGpm: z.number(),
    depthGpm: z.number().positive(),
  }),
  levels: z.array(profileLevelResultSchema).length(2),
  diagnostics: z.array(layerDiagnosticResultSchema).min(1),
  source: ifsDiagnosticSourceSchema,
});

export const ifsProfileDiagnosticsResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(240),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  sampledPressureLevelsHpa: z.array(z.number().positive()).min(2),
  levels: z.array(profileLevelResultSchema).min(2),
  diagnostics: z.array(profileDiagnosticResultSchema).min(1),
  source: ifsDiagnosticSourceSchema,
});

export const ifsParcelDiagnosticsResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(240),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  sampledPressureLevelsHpa: z.array(z.number().positive()).min(2),
  levels: z.array(profileLevelResultSchema).min(2),
  parcel: parcelComputationSchema,
  source: ifsDiagnosticSourceSchema,
});

function validateIfsDiagnosticVariables(variables: readonly string[], context: z.RefinementCtx): void {
  const supported = new Set<string>(IFS_RAW_PRESSURE_VARIABLE_IDS);
  for (const variable of variables) {
    if (!supported.has(variable)) {
      context.addIssue({
        code: "custom",
        path: ["diagnostics"],
        message: `IFS Open Data does not support required diagnostic pressure variable ${variable}`,
      });
    }
  }
}

export type IfsLayerDiagnosticsQueryInput = z.input<typeof ifsLayerDiagnosticsQuerySchema>;
export type IfsLayerDiagnosticsResult = z.infer<typeof ifsLayerDiagnosticsResultSchema>;
export type IfsProfileDiagnosticsQueryInput = z.input<typeof ifsProfileDiagnosticsQuerySchema>;
export type IfsProfileDiagnosticsResult = z.infer<typeof ifsProfileDiagnosticsResultSchema>;
export type IfsParcelDiagnosticsQueryInput = z.input<typeof ifsParcelDiagnosticsQuerySchema>;
export type IfsParcelDiagnosticsResult = z.infer<typeof ifsParcelDiagnosticsResultSchema>;
