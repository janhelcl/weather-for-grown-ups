import * as z from "zod/v4";
import {
  historicalAnalysisSourceSchema,
} from "./history-result.js";
import { LAYER_DIAGNOSTIC_IDS } from "../catalog/layer-diagnostics.js";
import { PROFILE_DIAGNOSTIC_IDS } from "../catalog/profile-diagnostics.js";
import { historicalAnalysisTimeSchema } from "./history.js";
import {
  gridPointSchema,
  layerDiagnosticResultSchema,
  profileDiagnosticResultSchema,
  profileLevelResultSchema,
} from "./result.js";
import { pointCoordinateSchema, pressureLevelSchema } from "./query.js";

export const historicalLayerDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  analysisTime: historicalAnalysisTimeSchema,
  lowerPressureHpa: pressureLevelSchema,
  upperPressureHpa: pressureLevelSchema,
  diagnostics: z.array(z.enum(LAYER_DIAGNOSTIC_IDS)).min(1),
}).superRefine((query, context) => {
  if (query.lowerPressureHpa <= query.upperPressureHpa) {
    context.addIssue({
      code: "custom",
      path: ["upperPressureHpa"],
      message: "lowerPressureHpa must be greater than upperPressureHpa so the layer is ordered from lower to upper altitude",
    });
  }
});

export const historicalProfileDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  analysisTime: historicalAnalysisTimeSchema,
  pressureLevelsHpa: z.array(pressureLevelSchema).min(2),
  diagnostics: z.array(z.enum(PROFILE_DIAGNOSTIC_IDS)).min(1),
}).superRefine((query, context) => {
  if (new Set(query.pressureLevelsHpa).size < 2) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelsHpa"],
      message: "Historical whole-profile diagnostics require at least two distinct pressure levels",
    });
  }
});

const historicalDiagnosticSourceSchema = historicalAnalysisSourceSchema;

const historicalDiagnosticCaveatSchema = z.literal(
  "Diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis",
);

export const historicalLayerDiagnosticsResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  analysisTime: historicalAnalysisTimeSchema,
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
  source: historicalDiagnosticSourceSchema,
  caveat: historicalDiagnosticCaveatSchema,
});

export const historicalProfileDiagnosticsResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  analysisTime: historicalAnalysisTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  sampledPressureLevelsHpa: z.array(z.number().positive()).min(2),
  levels: z.array(profileLevelResultSchema).min(2),
  diagnostics: z.array(profileDiagnosticResultSchema).min(1),
  source: historicalDiagnosticSourceSchema,
  caveat: historicalDiagnosticCaveatSchema,
});

export type HistoricalLayerDiagnosticsQueryInput = z.input<typeof historicalLayerDiagnosticsQuerySchema>;
export type HistoricalProfileDiagnosticsQueryInput = z.input<typeof historicalProfileDiagnosticsQuerySchema>;
export type HistoricalLayerDiagnosticsResult = z.infer<typeof historicalLayerDiagnosticsResultSchema>;
export type HistoricalProfileDiagnosticsResult = z.infer<typeof historicalProfileDiagnosticsResultSchema>;
