import * as z from "zod/v4";
import { areaSummaryResultSchema as baseAreaSummaryResultSchema, gridPointSchema } from "./result.js";
import { AREA_PERCENTILE_METHOD } from "./area-summary.js";

export const areaDistributionResultSchema = z.object({
  percentileMethod: z.literal(AREA_PERCENTILE_METHOD).optional(),
  percentiles: z.array(z.object({
    percentile: z.number().min(0).max(100),
    value: z.number(),
  })).optional(),
  thresholdFractions: z.array(z.object({
    operator: z.enum(["gte", "lte"]),
    threshold: z.number(),
    matchingGridPoints: z.number().int().nonnegative(),
    fraction: z.number().min(0).max(1),
  })).optional(),
  extrema: z.object({
    min: z.object({
      value: z.number(),
      gridPoint: gridPointSchema,
      tiedGridPoints: z.number().int().positive(),
    }),
    max: z.object({
      value: z.number(),
      gridPoint: gridPointSchema,
      tiedGridPoints: z.number().int().positive(),
    }),
  }).optional(),
}).superRefine((distribution, context) => {
  if (distribution.percentiles !== undefined && distribution.percentileMethod === undefined) {
    context.addIssue({ code: "custom", path: ["percentileMethod"], message: "Percentile results require an explicit method" });
  }
  if (distribution.percentiles === undefined && distribution.percentileMethod !== undefined) {
    context.addIssue({ code: "custom", path: ["percentileMethod"], message: "Percentile method is only returned with percentile results" });
  }
});

export const areaSummaryResultSchema = baseAreaSummaryResultSchema.safeExtend({
  distribution: areaDistributionResultSchema.optional(),
});

export type AreaSummaryResult = z.infer<typeof areaSummaryResultSchema>;
