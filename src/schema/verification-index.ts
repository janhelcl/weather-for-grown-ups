import * as z from "zod/v4";
import { gfsGridSchema } from "./gfs-grid.js";
import {
  HISTORICAL_GFS_VARIABLE_IDS,
  historicalAnalysisTimeSchema,
  historicalCycleHourUtcSchema,
} from "./history.js";
import { historicalVerificationLeadHoursSchema } from "./history-verification.js";
import { historicalForecastVerificationResultSchema } from "./history-verification-result.js";
import { IGRA_VERIFICATION_VARIABLE_IDS, igraForecastVerificationResultSchema } from "./igra-verification.js";
import { isoDateTimeSchema, pointCoordinateSchema, pressureLevelSchema } from "./query.js";
import { gridPointSchema } from "./result.js";

export const verificationReferenceDatasetSchema = z.enum(["gfs-analysis", "igra"]);
export type VerificationReferenceDataset = z.infer<typeof verificationReferenceDatasetSchema>;

export const DEFAULT_VERIFICATION_INDEX_MAX_FETCHES = 16;
export const MAX_VERIFICATION_INDEX_MAX_FETCHES = 256;
export const MAX_VERIFICATION_INDEX_SELECTED_EVALUATIONS = 250_000;

const verificationRequestBaseSchema = z.object({
  requestedPoint: gridPointSchema,
  validTime: historicalAnalysisTimeSchema,
  leadHours: historicalVerificationLeadHoursSchema,
  variables: z.array(z.string().min(1)).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
});

export const verificationIndexRecordSchema = z.discriminatedUnion("referenceDataset", [
  z.object({
    version: z.literal(1),
    referenceDataset: z.literal("gfs-analysis"),
    request: verificationRequestBaseSchema,
    result: historicalForecastVerificationResultSchema,
  }),
  z.object({
    version: z.literal(1),
    referenceDataset: z.literal("igra"),
    request: verificationRequestBaseSchema.extend({
      gfsGrid: gfsGridSchema.optional(),
      stationId: z.string().regex(/^[A-Z0-9]{11}$/).optional(),
      maxStationDistanceKm: z.number().positive().max(1_000).default(250),
    }),
    result: igraForecastVerificationResultSchema,
  }),
]);

export type VerificationIndexRecord = z.infer<typeof verificationIndexRecordSchema>;

const verificationRangeBaseSchema = z.object({
  referenceDataset: verificationReferenceDatasetSchema.default("gfs-analysis"),
  ...pointCoordinateSchema.shape,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1).max(4).default([0, 12]),
  leadHours: z.array(historicalVerificationLeadHoursSchema).min(1).max(33),
  variables: z.array(z.string().min(1)).min(1),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1),
  gfsGrid: gfsGridSchema.optional(),
  stationId: z.string().regex(/^[A-Z0-9]{11}$/).optional(),
  maxStationDistanceKm: z.number().positive().max(1_000).optional(),
});

function validateReferenceControls(query: z.infer<typeof verificationRangeBaseSchema>, context: z.RefinementCtx): void {
  if (new Date(query.startTime) > new Date(query.endTime)) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be greater than or equal to startTime" });
  }
  if (new Set(query.cycleHoursUtc).size !== query.cycleHoursUtc.length) {
    context.addIssue({ code: "custom", path: ["cycleHoursUtc"], message: "cycleHoursUtc must not contain duplicates" });
  }
  if (new Set(query.leadHours).size !== query.leadHours.length) {
    context.addIssue({ code: "custom", path: ["leadHours"], message: "leadHours must not contain duplicates" });
  }

  if (query.referenceDataset === "gfs-analysis") {
    for (const key of ["gfsGrid", "stationId", "maxStationDistanceKm"] as const) {
      if (query[key] !== undefined) {
        context.addIssue({ code: "custom", path: [key], message: `${key} is only valid when referenceDataset=igra` });
      }
    }
    const supported = new Set<string>(HISTORICAL_GFS_VARIABLE_IDS);
    const unsupported = query.variables.filter((variable) => !supported.has(variable));
    if (unsupported.length > 0) {
      context.addIssue({ code: "custom", path: ["variables"], message: `gfs-analysis verification does not support: ${unsupported.join(", ")}` });
    }
    return;
  }

  const supported = new Set<string>(IGRA_VERIFICATION_VARIABLE_IDS);
  const unsupported = query.variables.filter((variable) => !supported.has(variable));
  if (unsupported.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["variables"],
      message: `IGRA verification supports only ${IGRA_VERIFICATION_VARIABLE_IDS.join(", ")}; unsupported: ${unsupported.join(", ")}`,
    });
  }
}

export const verificationIndexBackfillQuerySchema = verificationRangeBaseSchema.extend({
  maxFetches: z.number().int().min(1).max(MAX_VERIFICATION_INDEX_MAX_FETCHES).default(DEFAULT_VERIFICATION_INDEX_MAX_FETCHES),
  order: z.enum(["oldest_first", "newest_first"]).default("oldest_first"),
  dryRun: z.boolean().default(false),
  continueOnError: z.boolean().default(false),
}).superRefine((query, context) => validateReferenceControls(query, context));

export type VerificationIndexBackfillQueryInput = z.input<typeof verificationIndexBackfillQuerySchema>;

export const verificationIndexBackfillResultSchema = z.object({
  model: z.literal("verification_index_backfill"),
  indexPath: z.string().min(1),
  referenceDataset: verificationReferenceDatasetSchema,
  requestedPoint: gridPointSchema,
  period: z.object({
    startTime: isoDateTimeSchema,
    endTime: isoDateTimeSchema,
    cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1),
  }),
  leadHours: z.array(historicalVerificationLeadHoursSchema).min(1),
  selection: z.object({
    variables: z.array(z.string().min(1)).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
  }),
  selectedValidTimes: z.number().int().nonnegative(),
  selectedEvaluations: z.number().int().nonnegative(),
  alreadyMaterialized: z.number().int().nonnegative(),
  fetchBudget: z.number().int().positive(),
  attempted: z.number().int().nonnegative(),
  materialized: z.number().int().nonnegative(),
  failures: z.array(z.object({
    validTime: historicalAnalysisTimeSchema,
    leadHours: historicalVerificationLeadHoursSchema,
    message: z.string().min(1),
  })),
  remaining: z.number().int().nonnegative(),
  nextEvaluation: z.object({
    validTime: historicalAnalysisTimeSchema,
    leadHours: historicalVerificationLeadHoursSchema,
  }).nullable(),
  status: z.enum(["complete", "budget_exhausted", "stopped_on_error", "errors_remaining", "dry_run"]),
  note: z.literal("resumable verification backfill skips materialized atomic cases; archive and observation access remains serial and NOAA-paced"),
});

export type VerificationIndexBackfillResult = z.infer<typeof verificationIndexBackfillResultSchema>;

export const verificationIndexSkillQuerySchema = verificationRangeBaseSchema.extend({
  monthsUtc: z.array(z.number().int().min(1).max(12)).min(1).max(12).optional(),
}).superRefine((query, context) => {
  validateReferenceControls(query, context);
  if (query.monthsUtc !== undefined && new Set(query.monthsUtc).size !== query.monthsUtc.length) {
    context.addIssue({ code: "custom", path: ["monthsUtc"], message: "monthsUtc must not contain duplicates" });
  }
});

export type VerificationIndexSkillQueryInput = z.input<typeof verificationIndexSkillQuerySchema>;

const verificationIndexStatisticSchema = z.object({
  leadHours: historicalVerificationLeadHoursSchema,
  pressureHpa: z.number().positive(),
  field: z.string().min(1),
  deltaKind: z.enum(["linear", "circular_degrees"]),
  count: z.number().int().positive(),
  bias: z.number(),
  mae: z.number().nonnegative(),
  rmse: z.number().nonnegative(),
});

export const verificationIndexSkillResultSchema = z.object({
  model: z.literal("verification_index_skill_summary"),
  indexPath: z.string().min(1),
  referenceDataset: verificationReferenceDatasetSchema,
  requestedPoint: gridPointSchema,
  period: z.object({
    startTime: isoDateTimeSchema,
    endTime: isoDateTimeSchema,
    cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1),
    monthsUtc: z.array(z.number().int().min(1).max(12)).optional(),
    eligibleValidTimes: z.number().int().nonnegative(),
    expectedEvaluations: z.number().int().nonnegative(),
  }),
  leadHours: z.array(historicalVerificationLeadHoursSchema).min(1),
  selection: z.object({
    variables: z.array(z.string().min(1)).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
  }),
  coverage: z.object({
    materializedEvaluations: z.number().int().nonnegative(),
    missingEvaluations: z.number().int().nonnegative(),
    coverageRate: z.number().min(0).max(1),
  }),
  statistics: z.array(verificationIndexStatisticSchema),
  stations: z.array(z.object({
    id: z.string().length(11),
    name: z.string().min(1),
    latitude: z.number(),
    longitude: z.number(),
    elevationM: z.number().optional(),
  })).optional(),
  source: z.object({
    access: z.literal("local_jsonl"),
    upstreamRequests: z.literal(0),
  }),
  caveat: z.string().min(1),
});

export type VerificationIndexSkillResult = z.infer<typeof verificationIndexSkillResultSchema>;
