import * as z from "zod/v4";
import {
  MAX_FORECAST_SKILL_EVALUATIONS,
  MAX_FORECAST_SKILL_LEADS,
  MAX_FORECAST_SKILL_VALID_TIMES,
} from "./forecast-skill.js";
import {
  historicalAnalysisTimeSchema,
  historicalCycleHourUtcSchema,
  historicalGfsVariableIdSchema,
} from "./history.js";
import { historicalVerificationLeadHoursSchema } from "./history-verification.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";
import { gridPointSchema } from "./result.js";

export const historicalForecastSkillQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1).max(4).default([0, 6, 12, 18]),
  leadHours: z.array(historicalVerificationLeadHoursSchema).min(1).max(MAX_FORECAST_SKILL_LEADS),
  variables: z.array(historicalGfsVariableIdSchema).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
  maxValidTimes: z.number().int().min(1).max(MAX_FORECAST_SKILL_VALID_TIMES).default(MAX_FORECAST_SKILL_VALID_TIMES),
}).superRefine((query, context) => {
  if (new Date(query.endTime) < new Date(query.startTime)) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be greater than or equal to startTime" });
  }
  if (new Set(query.cycleHoursUtc).size !== query.cycleHoursUtc.length) {
    context.addIssue({ code: "custom", path: ["cycleHoursUtc"], message: "cycleHoursUtc must not contain duplicates" });
  }
  if (new Set(query.leadHours).size !== query.leadHours.length) {
    context.addIssue({ code: "custom", path: ["leadHours"], message: "leadHours must not contain duplicates" });
  }
  if (query.maxValidTimes * query.leadHours.length > MAX_FORECAST_SKILL_EVALUATIONS) {
    context.addIssue({
      code: "custom",
      path: ["maxValidTimes"],
      message: `Forecast skill summary is bounded to ${MAX_FORECAST_SKILL_EVALUATIONS} forecast evaluations`,
    });
  }
});

const skillEvaluationSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    validTime: historicalAnalysisTimeSchema,
    leadHours: historicalVerificationLeadHoursSchema,
    gridPoint: gridPointSchema,
  }),
  z.object({
    status: z.literal("failed"),
    validTime: historicalAnalysisTimeSchema,
    leadHours: historicalVerificationLeadHoursSchema,
    error: z.string().min(1),
  }),
]);

const skillStatisticSchema = z.object({
  leadHours: historicalVerificationLeadHoursSchema,
  pressureHpa: z.number().positive(),
  field: z.string().min(1),
  deltaKind: z.enum(["linear", "circular_degrees"]),
  count: z.number().int().positive(),
  bias: z.number(),
  mae: z.number().nonnegative(),
  rmse: z.number().nonnegative(),
});

export const historicalForecastSkillResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_skill_summary_0p5"),
  requestedPoint: gridPointSchema,
  period: z.object({
    startTime: isoDateTimeSchema,
    endTime: isoDateTimeSchema,
    cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1),
    eligibleValidTimes: z.number().int().nonnegative(),
    sampledValidTimes: z.array(historicalAnalysisTimeSchema),
    truncated: z.boolean(),
    sampling: z.literal("evenly_spaced_nominal_times"),
  }),
  leadHours: z.array(historicalVerificationLeadHoursSchema).min(1),
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
  }),
  comparison: z.literal("analysis_minus_forecast"),
  evaluations: z.array(skillEvaluationSchema),
  availability: z.object({
    requestedEvaluations: z.number().int().nonnegative(),
    successfulEvaluations: z.number().int().nonnegative(),
    failedEvaluations: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
  }),
  statistics: z.array(skillStatisticSchema),
  source: z.object({
    forecastDataset: z.literal("gfs"),
    referenceDataset: z.literal("gfs-analysis"),
    provider: z.union([z.literal("NOAA NCEI"), z.literal("NOAA AWS Open Data")]),
    grid: z.literal("0p50"),
  }),
  caveat: z.literal("Skill statistics compare archived GFS forecasts with later GFS model analyses, not direct observations; each statistic reports its own sample count, failures remain explicit, and historical GFS model versions changed over time"),
});

export type HistoricalForecastSkillQueryInput = z.input<typeof historicalForecastSkillQuerySchema>;
export type HistoricalForecastSkillResult = z.infer<typeof historicalForecastSkillResultSchema>;
