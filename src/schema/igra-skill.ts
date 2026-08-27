import * as z from "zod/v4";
import {
  MAX_FORECAST_SKILL_EVALUATIONS,
  MAX_FORECAST_SKILL_LEADS,
  MAX_FORECAST_SKILL_VALID_TIMES,
} from "./forecast-skill.js";
import { gfsGridSchema } from "./gfs-grid.js";
import {
  historicalAnalysisTimeSchema,
  historicalCycleHourUtcSchema,
} from "./history.js";
import { historicalVerificationLeadHoursSchema } from "./history-verification.js";
import {
  igraVerificationVariableSchema,
} from "./igra-verification.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";
import { gridPointSchema } from "./result.js";

export const MAX_IGRA_SKILL_VALID_TIMES = MAX_FORECAST_SKILL_VALID_TIMES;
export const MAX_IGRA_SKILL_LEADS = MAX_FORECAST_SKILL_LEADS;
export const MAX_IGRA_SKILL_EVALUATIONS = MAX_FORECAST_SKILL_EVALUATIONS;

export const igraForecastSkillQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema)
    .min(1)
    .max(4)
    .default([0, 12]),
  leadHours: z.array(historicalVerificationLeadHoursSchema)
    .min(1)
    .max(MAX_IGRA_SKILL_LEADS),
  variables: z.array(igraVerificationVariableSchema).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
  stationId: z.string().regex(/^[A-Z0-9]{11}$/).optional(),
  maxStationDistanceKm: z.number().positive().max(1_000).default(250),
  gfsGrid: gfsGridSchema.optional(),
  maxValidTimes: z.number().int().min(1).max(MAX_IGRA_SKILL_VALID_TIMES)
    .default(MAX_IGRA_SKILL_VALID_TIMES),
}).superRefine((query, context) => {
  if (new Date(query.endTime) < new Date(query.startTime)) {
    context.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "endTime must be greater than or equal to startTime",
    });
  }

  if (new Set(query.cycleHoursUtc).size !== query.cycleHoursUtc.length) {
    context.addIssue({
      code: "custom",
      path: ["cycleHoursUtc"],
      message: "cycleHoursUtc must not contain duplicates",
    });
  }

  if (new Set(query.leadHours).size !== query.leadHours.length) {
    context.addIssue({
      code: "custom",
      path: ["leadHours"],
      message: "leadHours must not contain duplicates",
    });
  }

  if (query.maxValidTimes * query.leadHours.length > MAX_IGRA_SKILL_EVALUATIONS) {
    context.addIssue({
      code: "custom",
      path: ["maxValidTimes"],
      message: `IGRA skill summary is bounded to ${MAX_IGRA_SKILL_EVALUATIONS} forecast evaluations`,
    });
  }
});

export type IgraForecastSkillQueryInput = z.input<typeof igraForecastSkillQuerySchema>;
export type IgraForecastSkillQuery = z.output<typeof igraForecastSkillQuerySchema>;

const skillEvaluationSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    validTime: historicalAnalysisTimeSchema,
    leadHours: historicalVerificationLeadHoursSchema,
    stationId: z.string().length(11),
    gfsGrid: gfsGridSchema,
    matchedPressureLevelsHpa: z.array(z.number().positive()),
    missingPressureLevelsHpa: z.array(z.number().positive()),
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

export const igraForecastSkillResultSchema = z.object({
  model: z.literal("gfs_igra_skill_summary"),
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
    variables: z.array(igraVerificationVariableSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
  }),
  comparison: z.literal("observation_minus_forecast"),
  evaluations: z.array(skillEvaluationSchema),
  availability: z.object({
    requestedEvaluations: z.number().int().nonnegative(),
    successfulEvaluations: z.number().int().nonnegative(),
    failedEvaluations: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
  }),
  statistics: z.array(skillStatisticSchema),
  stations: z.array(z.object({
    id: z.string().length(11),
    name: z.string().min(1),
    latitude: z.number(),
    longitude: z.number(),
    elevationM: z.number().optional(),
  })),
  source: z.object({
    forecastDataset: z.literal("gfs"),
    referenceDataset: z.literal("igra_v2_2"),
    provider: z.literal("NOAA NCEI"),
  }),
  caveat: z.literal(
    "Skill statistics aggregate only successful radiosonde comparisons; each statistic reports its own sample count, failures remain explicit, and sounding/model representativeness limitations still apply",
  ),
});

export type IgraForecastSkillResult = z.infer<typeof igraForecastSkillResultSchema>;
