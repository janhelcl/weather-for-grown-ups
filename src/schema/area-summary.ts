import * as z from "zod/v4";
import { areaSummaryQuerySchema as baseAreaSummaryQuerySchema } from "./query.js";

export const AREA_PERCENTILE_METHOD = "linear_interpolation_sorted_defined_grid_points" as const;
export const MAX_AREA_PERCENTILES = 20;
export const MAX_AREA_THRESHOLDS = 20;

export const areaThresholdSchema = z.object({
  operator: z.enum(["gte", "lte"]),
  value: z.number().describe("Threshold in the normalized public output unit"),
});

export const areaSummaryQuerySchema = baseAreaSummaryQuerySchema.safeExtend({
  percentiles: z.array(z.number().min(0).max(100)).max(MAX_AREA_PERCENTILES).optional(),
  thresholds: z.array(areaThresholdSchema).max(MAX_AREA_THRESHOLDS).optional(),
  includeExtremaLocations: z.boolean().default(false),
}).superRefine((query, context) => {
  if (query.percentiles !== undefined && new Set(query.percentiles).size !== query.percentiles.length) {
    context.addIssue({
      code: "custom",
      path: ["percentiles"],
      message: "Area percentiles must be unique",
    });
  }
});

export type AreaThreshold = z.infer<typeof areaThresholdSchema>;
export type AreaSummaryQuery = z.output<typeof areaSummaryQuerySchema>;
export type AreaSummaryQueryInput = z.input<typeof areaSummaryQuerySchema>;
