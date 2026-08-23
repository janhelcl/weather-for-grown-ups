import * as z from "zod/v4";
import {
  GEFS_MEMBERS,
  GEFS_PGRB2A_PRESSURE_VARIABLES,
  isSupportedGefsPressureSelection,
  type GefsPressureVariableId,
} from "../catalog/gefs.js";
import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import {
  gefsMemberSchema,
  gefsRunSelectorSchema,
} from "./gefs-ensemble.js";
import {
  isoDateTimeSchema,
  layerDiagnosticIdSchema,
  pointCoordinateSchema,
} from "./query.js";

export const gefsLayerDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: gefsRunSelectorSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time on the native three-hour GEFS cadence"),
  lowerPressureHpa: z.number().positive().describe("Lower-altitude pressure surface; must exceed upperPressureHpa"),
  upperPressureHpa: z.number().positive().describe("Upper-altitude pressure surface"),
  diagnostics: z.array(layerDiagnosticIdSchema).min(1),
  members: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).default([...GEFS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false).describe(
    "Include each member's input layer and diagnostic values. Distribution summaries are always returned.",
  ),
}).superRefine((query, context) => {
  if (query.lowerPressureHpa <= query.upperPressureHpa) {
    context.addIssue({
      code: "custom",
      path: ["upperPressureHpa"],
      message: "lowerPressureHpa must be greater than upperPressureHpa so the layer is ordered from lower to upper altitude",
    });
  }
  if (new Set(query.diagnostics).size !== query.diagnostics.length) {
    context.addIssue({ code: "custom", path: ["diagnostics"], message: "GEFS layer diagnostic selection must not contain duplicates" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFS member selection must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }

  const supportedVariables = new Set<string>(GEFS_PGRB2A_PRESSURE_VARIABLES);
  const variables = expandLayerDiagnosticVariables(query.diagnostics);
  for (const variable of variables) {
    if (!supportedVariables.has(variable)) {
      context.addIssue({
        code: "custom",
        path: ["diagnostics"],
        message: `GEFS pgrb2a does not support required layer-diagnostic variable ${variable}`,
      });
      continue;
    }
    for (const pressureLevelHpa of [query.lowerPressureHpa, query.upperPressureHpa]) {
      if (!isSupportedGefsPressureSelection(variable as GefsPressureVariableId, pressureLevelHpa)) {
        context.addIssue({
          code: "custom",
          path: pressureLevelHpa === query.lowerPressureHpa ? ["lowerPressureHpa"] : ["upperPressureHpa"],
          message: `GEFS pgrb2a does not publish required ${variable} at ${pressureLevelHpa} hPa for this diagnostic selection`,
        });
      }
    }
  }
});

const quantileSchema = z.object({
  quantile: z.number().min(0).max(1),
  value: z.number(),
});

const numericDistributionSchema = z.object({
  memberCount: z.number().int().min(2),
  mean: z.number(),
  populationStdDev: z.number().nonnegative(),
  min: z.number(),
  max: z.number(),
  quantiles: z.array(quantileSchema).min(1),
});

export const gefsLayerDiagnosticsResultSchema = z.object({
  model: z.literal("gefs_0p50"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  pressureLayer: z.object({
    lowerPressureHpa: z.number().positive(),
    upperPressureHpa: z.number().positive(),
  }),
  selection: z.object({
    diagnostics: z.array(layerDiagnosticIdSchema).min(1),
    members: z.array(gefsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  layerDepthGpm: numericDistributionSchema,
  summaries: z.array(z.object({
    id: layerDiagnosticIdSchema,
    field: z.string().min(1),
    unit: z.string().min(1),
    distribution: numericDistributionSchema,
  })).min(1),
  members: z.array(z.object({
    member: gefsMemberSchema,
    cacheHit: z.boolean(),
    layer: z.object({
      lowerPressureHpa: z.number().positive(),
      upperPressureHpa: z.number().positive(),
      lowerGeopotentialHeightGpm: z.number(),
      upperGeopotentialHeightGpm: z.number(),
      depthGpm: z.number().positive(),
    }),
    diagnostics: z.array(z.object({
      id: layerDiagnosticIdSchema,
      values: z.record(z.string(), z.number()),
    })).min(1),
  })).min(2).optional(),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.literal("wgrib2"),
    product: z.literal("pgrb2a_0p50"),
    allCacheHit: z.boolean(),
  }),
});

export type GefsLayerDiagnosticsQueryInput = z.input<typeof gefsLayerDiagnosticsQuerySchema>;
export type GefsLayerDiagnosticsResult = z.infer<typeof gefsLayerDiagnosticsResultSchema>;
