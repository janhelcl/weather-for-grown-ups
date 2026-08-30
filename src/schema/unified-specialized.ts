import * as z from "zod/v4";
import { GEFS_MEMBERS, isSupportedGefsProfileSelection } from "../catalog/gefs.js";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import { gfsGridSchema } from "./gfs-grid.js";
import {
  HISTORICAL_GFS_VARIABLE_IDS,
  historicalCycleHourUtcSchema,
} from "./history.js";
import { historicalVerificationLeadHoursSchema } from "./history-verification.js";
import {
  MAX_FORECAST_SKILL_EVALUATIONS,
  MAX_FORECAST_SKILL_LEADS,
  MAX_FORECAST_SKILL_VALID_TIMES,
} from "./forecast-skill.js";
import {
  IGRA_VERIFICATION_VARIABLE_IDS,
  igraVerificationVariableSchema,
} from "./igra-verification.js";
import { gefsMemberSchema } from "./gefs-ensemble.js";
import { gefsIfsEnsComparisonVariableSchema } from "./gefs-ifs-ens-comparison.js";
import { ifsEnsMemberSchema } from "./ifs-ens.js";
import { ifsIfsEnsComparisonVariableSchema } from "./ifs-ifs-ens-comparison.js";
import { ifsPressureLevelSchema, ifsPressureVariableSchema } from "./ifs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";
import {
  atmosphericEnsembleOptionsSchema,
  atmosphericSelectionSchema,
  publicAtmosphericDatasetSchema,
} from "./unified-api.js";

export const compareAtmosphericRunsSchema = z.object({
  dataset: z.enum(["gfs", "gefs", "ifs", "ifs-ens"]),
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({ at: isoDateTimeSchema }),
  selection: atmosphericSelectionSchema,
  anchorRun: z.string().min(1).default("latest"),
  gfsGrid: gfsGridSchema.optional(),
  cycles: z.number().int().min(2).max(6).default(3),
  ensemble: atmosphericEnsembleOptionsSchema.optional(),
  thresholdGte: z.number().optional(),
  cycleStrideHours: z.union([z.literal(6), z.literal(12)]).optional(),
}).superRefine((request, context) => {
  if (request.dataset !== "gfs" && request.gfsGrid !== undefined) {
    context.addIssue({ code: "custom", path: ["gfsGrid"], message: "gfsGrid is only valid for GFS run comparison" });
  }
  if (request.dataset !== "gefs" && request.dataset !== "ifs-ens" && request.ensemble !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["ensemble"],
      message: "ensemble controls are only valid for gefs or ifs-ens run comparison",
    });
  }
  if (request.dataset !== "gefs" && request.dataset !== "ifs-ens" && request.thresholdGte !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["thresholdGte"],
      message: "thresholdGte is only valid for ensemble run comparison",
    });
  }
  if (request.dataset !== "ifs-ens" && request.cycleStrideHours !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["cycleStrideHours"],
      message: "cycleStrideHours is currently only configurable for ifs-ens run comparison",
    });
  }
  if (request.dataset === "gefs" || request.dataset === "ifs-ens") {
    const variables = request.selection.variables?.length ?? 0;
    const levels = request.selection.pressureLevelsHpa?.length ?? 0;
    const fields = request.selection.fields?.length ?? 0;
    if (variables !== 1 || levels !== 1 || fields !== 0) {
      context.addIssue({
        code: "custom",
        path: ["selection"],
        message: "Ensemble run comparison currently requires exactly one pressure variable at one pressure level",
      });
    }
  }
});

const compareGfsGefsDatasetsSchema = z.object({
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

const compareGfsIfsDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("gfs"), z.literal("ifs")]),
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({ at: isoDateTimeSchema }),
  variable: ifsPressureVariableSchema,
  pressureLevelHpa: ifsPressureLevelSchema,
  run: z.string().min(1).default("latest"),
  gfsGrid: gfsGridSchema.optional(),
  members: z.never().optional(),
  quantiles: z.never().optional(),
});

export const compareGefsIfsEnsDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("gefs"), z.literal("ifs-ens")]),
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({ at: isoDateTimeSchema }),
  variable: gefsIfsEnsComparisonVariableSchema,
  pressureLevelHpa: ifsPressureLevelSchema,
  run: z.string().min(1).default("latest"),
  gefsMembers: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).optional(),
  ifsEnsMembers: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).optional(),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).optional(),
  thresholdGte: z.number().optional(),
  gfsGrid: z.never().optional(),
  members: z.never().optional(),
}).superRefine((request, context) => {
  if (!isSupportedGefsProfileSelection(request.variable, request.pressureLevelHpa)) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelHpa"],
      message: `GEFS cannot satisfy ${request.variable} at ${request.pressureLevelHpa} hPa in the cross-ensemble comparison contract`,
    });
  }
  if (request.gefsMembers && new Set(request.gefsMembers).size !== request.gefsMembers.length) {
    context.addIssue({ code: "custom", path: ["gefsMembers"], message: "GEFS member selection must not contain duplicates" });
  }
  if (request.ifsEnsMembers && new Set(request.ifsEnsMembers).size !== request.ifsEnsMembers.length) {
    context.addIssue({ code: "custom", path: ["ifsEnsMembers"], message: "IFS ENS member selection must not contain duplicates" });
  }
  if (request.quantiles && new Set(request.quantiles).size !== request.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantile selection must not contain duplicates" });
  }
});

export const compareIfsIfsEnsDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("ifs"), z.literal("ifs-ens")]),
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({ at: isoDateTimeSchema }),
  variable: ifsIfsEnsComparisonVariableSchema,
  pressureLevelHpa: ifsPressureLevelSchema,
  run: z.string().min(1).default("latest"),
  ifsEnsMembers: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).optional(),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).optional(),
  gfsGrid: z.never().optional(),
  members: z.never().optional(),
  gefsMembers: z.never().optional(),
  thresholdGte: z.never().optional(),
}).superRefine((request, context) => {
  if (request.ifsEnsMembers && new Set(request.ifsEnsMembers).size !== request.ifsEnsMembers.length) {
    context.addIssue({
      code: "custom",
      path: ["ifsEnsMembers"],
      message: "IFS ENS member selection must not contain duplicates",
    });
  }
  if (request.quantiles && new Set(request.quantiles).size !== request.quantiles.length) {
    context.addIssue({
      code: "custom",
      path: ["quantiles"],
      message: "Quantile selection must not contain duplicates",
    });
  }
});

export const compareAtmosphericDatasetsSchema = z.union([
  compareGfsGefsDatasetsSchema,
  compareGfsIfsDatasetsSchema,
  compareGefsIfsEnsDatasetsSchema,
  compareIfsIfsEnsDatasetsSchema,
]);

const verifyAtmosphericForecastCaseSchema = z.object({
  forecastDataset: z.literal("gfs").default("gfs"),
  referenceDataset: z.enum(["gfs-analysis", "igra"]).default("gfs-analysis"),
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({ at: isoDateTimeSchema }),
  leadHours: historicalVerificationLeadHoursSchema,
  variables: z.array(z.string().min(1)).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
  gfsGrid: gfsGridSchema.optional(),
  stationId: z.string().regex(/^[A-Z0-9]{11}$/).optional(),
  maxStationDistanceKm: z.number().positive().max(1_000).optional(),
}).superRefine((request, context) => {
  if (request.referenceDataset === "gfs-analysis") {
    for (const key of ["gfsGrid", "stationId", "maxStationDistanceKm"] as const) {
      if (request[key] !== undefined) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is only valid when referenceDataset=igra`,
        });
      }
    }
    return;
  }

  const supported = new Set<string>(IGRA_VERIFICATION_VARIABLE_IDS);
  const unsupported = request.variables.filter((variable) => !supported.has(variable));
  if (unsupported.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["variables"],
      message: `IGRA verification supports only ${IGRA_VERIFICATION_VARIABLE_IDS.join(", ")}; unsupported: ${unsupported.join(", ")}`,
    });
  }
});

const verifyAtmosphericForecastSkillSchema = z.object({
  forecastDataset: z.literal("gfs").default("gfs"),
  referenceDataset: z.enum(["gfs-analysis", "igra"]).default("gfs-analysis"),
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    hoursUtc: z.array(historicalCycleHourUtcSchema).min(1).max(4).default([0, 12]),
    maxValidTimes: z.number().int().min(1).max(MAX_FORECAST_SKILL_VALID_TIMES)
      .default(MAX_FORECAST_SKILL_VALID_TIMES),
  }),
  leadHours: z.array(historicalVerificationLeadHoursSchema).min(1).max(MAX_FORECAST_SKILL_LEADS),
  variables: z.array(z.string().min(1)).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
  gfsGrid: gfsGridSchema.optional(),
  stationId: z.string().regex(/^[A-Z0-9]{11}$/).optional(),
  maxStationDistanceKm: z.number().positive().max(1_000).optional(),
}).superRefine((request, context) => {
  if (new Date(request.time.to) < new Date(request.time.from)) {
    context.addIssue({
      code: "custom",
      path: ["time", "to"],
      message: "time.to must be greater than or equal to time.from",
    });
  }
  if (new Set(request.time.hoursUtc).size !== request.time.hoursUtc.length) {
    context.addIssue({
      code: "custom",
      path: ["time", "hoursUtc"],
      message: "time.hoursUtc must not contain duplicates",
    });
  }
  if (new Set(request.leadHours).size !== request.leadHours.length) {
    context.addIssue({
      code: "custom",
      path: ["leadHours"],
      message: "leadHours must not contain duplicates",
    });
  }
  if (request.time.maxValidTimes * request.leadHours.length > MAX_FORECAST_SKILL_EVALUATIONS) {
    context.addIssue({
      code: "custom",
      path: ["time", "maxValidTimes"],
      message: `Forecast skill summary is bounded to ${MAX_FORECAST_SKILL_EVALUATIONS} forecast evaluations`,
    });
  }

  if (request.referenceDataset === "igra") {
    const supported = new Set<string>(IGRA_VERIFICATION_VARIABLE_IDS);
    const unsupported = request.variables.filter((variable) => !supported.has(variable));
    if (unsupported.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["variables"],
        message: `IGRA verification supports only ${IGRA_VERIFICATION_VARIABLE_IDS.join(", ")}; unsupported: ${unsupported.join(", ")}`,
      });
    }
    return;
  }

  for (const key of ["gfsGrid", "stationId", "maxStationDistanceKm"] as const) {
    if (request[key] !== undefined) {
      context.addIssue({
        code: "custom",
        path: [key],
        message: `${key} is only valid when referenceDataset=igra`,
      });
    }
  }
  const supported = new Set<string>(HISTORICAL_GFS_VARIABLE_IDS);
  const unsupported = request.variables.filter((variable) => !supported.has(variable));
  if (unsupported.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["variables"],
      message: `gfs-analysis verification does not support: ${unsupported.join(", ")}`,
    });
  }
});

export const verifyAtmosphericForecastSchema = z.union([
  verifyAtmosphericForecastCaseSchema,
  verifyAtmosphericForecastSkillSchema,
]);

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
  datasets: z.array(z.union([publicAtmosphericDatasetSchema, z.literal("igra")])).min(1),
  result: z.unknown(),
});

export type CompareAtmosphericRunsInput = z.input<typeof compareAtmosphericRunsSchema>;
export type CompareAtmosphericDatasetsInput = z.input<typeof compareAtmosphericDatasetsSchema>;
export type VerifyAtmosphericForecastInput = z.input<typeof verifyAtmosphericForecastSchema>;
export type FindAtmosphericAnalogsInput = z.input<typeof findAtmosphericAnalogsSchema>;
export type UnifiedSpecializedResult = z.infer<typeof unifiedSpecializedResultSchema>;
