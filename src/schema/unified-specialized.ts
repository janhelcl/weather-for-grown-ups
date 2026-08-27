import * as z from "zod/v4";
import { gfsGridSchema } from "./gfs-grid.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";
import {
  atmosphericEnsembleOptionsSchema,
  atmosphericSelectionSchema,
  publicAtmosphericDatasetSchema,
} from "./unified-api.js";

export const compareAtmosphericRunsSchema = z.object({
  dataset: z.enum(["gfs", "gefs"]),
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({ at: isoDateTimeSchema }),
  selection: atmosphericSelectionSchema,
  anchorRun: z.string().min(1).default("latest"),
  gfsGrid: gfsGridSchema.optional(),
  cycles: z.number().int().min(2).max(6).default(3),
  ensemble: atmosphericEnsembleOptionsSchema.optional(),
  thresholdGte: z.number().optional(),
}).superRefine((request, context) => {
  if (request.dataset === "gefs" && request.gfsGrid !== undefined) {
    context.addIssue({ code: "custom", path: ["gfsGrid"], message: "gfsGrid is only valid for GFS run comparison" });
  }
  if (request.dataset !== "gefs" && request.ensemble !== undefined) {
    context.addIssue({ code: "custom", path: ["ensemble"], message: "ensemble controls are only valid for gefs" });
  }
  if (request.dataset === "gefs") {
    const variables = request.selection.variables?.length ?? 0;
    const levels = request.selection.pressureLevelsHpa?.length ?? 0;
    const fields = request.selection.fields?.length ?? 0;
    if (variables !== 1 || levels !== 1 || fields !== 0) {
      context.addIssue({
        code: "custom",
        path: ["selection"],
        message: "GEFS run comparison currently requires exactly one raw pressure variable at one pressure level",
      });
    }
  }
});

export const compareAtmosphericDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("gfs"), z.literal("gefs")]).default(["gfs", "gefs"]),
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({ at: isoDateTimeSchema }),
  variable: z.string().min(1),
  pressureLevelHpa: z.number().positive(),
  run: z.string().min(1).default("latest"),
  gfsGrid: gfsGridSchema.optional(),
  members: z.array(z.string().min(1)).min(2).max(31).optional(),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).optional(),
});

export const verifyAtmosphericForecastSchema = z.object({
  forecastDataset: z.literal("gfs").default("gfs"),
  referenceDataset: z.literal("gfs-analysis").default("gfs-analysis"),
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({ at: isoDateTimeSchema }),
  leadHours: z.number().int().min(0).max(192).refine(
    (value) => value % 6 === 0,
    "leadHours must be a multiple of 6",
  ),
  variables: z.array(z.string().min(1)).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
});

export const findAtmosphericAnalogsSchema = z.object({
  dataset: z.literal("gfs-analysis").default("gfs-analysis"),
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({ at: isoDateTimeSchema }),
  variables: z.array(z.string().min(1)).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
  count: z.number().int().min(1).max(20).default(5),
  excludeWithinHours: z.number().int().min(0).max(24 * 31).default(24),
  fetchTargetIfMissing: z.boolean().default(true),
});

export const unifiedSpecializedResultSchema = z.object({
  operation: z.enum(["compare_runs", "compare_datasets", "verify_forecast", "find_analogs"]),
  datasets: z.array(publicAtmosphericDatasetSchema).min(1),
  result: z.unknown(),
});

export type CompareAtmosphericRunsInput = z.input<typeof compareAtmosphericRunsSchema>;
export type CompareAtmosphericDatasetsInput = z.input<typeof compareAtmosphericDatasetsSchema>;
export type VerifyAtmosphericForecastInput = z.input<typeof verifyAtmosphericForecastSchema>;
export type FindAtmosphericAnalogsInput = z.input<typeof findAtmosphericAnalogsSchema>;
export type UnifiedSpecializedResult = z.infer<typeof unifiedSpecializedResultSchema>;
