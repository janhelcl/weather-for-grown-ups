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
import {
  compareAigfsAifsDatasetsSchema,
  compareGefsAigefsDatasetsSchema,
  compareGfsAigfsDatasetsSchema,
  compareHgefsAigefsDatasetsSchema,
  compareHgefsGefsDatasetsSchema,
  compareIfsAifsDatasetsSchema,
  compareIfsEnsAifsEnsDatasetsSchema,
} from "./model-class-comparison.js";
import {
  CROSS_SCALE_COMPARISON_PAIRS,
  compareGfsIconD2DatasetsSchema,
  compareIfsAromeDatasetsSchema,
  compareIfsEnsIconD2EpsDatasetsSchema,
  compareIfsEnsPeAromeDatasetsSchema,
  compareIfsIconD2DatasetsSchema,
} from "./cross-scale-comparison.js";
import { ifsPressureLevelSchema, ifsPressureVariableSchema } from "./ifs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";
import {
  atmosphericEnsembleOptionsSchema,
  atmosphericRunSelectorSchema,
  atmosphericSelectionSchema,
  publicAtmosphericDatasetSchema,
  publicDatasetCapabilities,
} from "./unified-api.js";

export const ATMOSPHERIC_DATASET_COMPARISON_PAIRS = [
  ["gfs", "gefs"],
  ["gfs", "ifs"],
  ["gefs", "ifs-ens"],
  ["ifs", "ifs-ens"],
  ["gfs", "aigfs"],
  ["ifs", "aifs"],
  ["aigfs", "aifs"],
  ["gefs", "aigefs"],
  ["ifs-ens", "aifs-ens"],
  ["hgefs", "gefs"],
  ["hgefs", "aigefs"],
  ...CROSS_SCALE_COMPARISON_PAIRS,
] as const;

export function isAtmosphericDatasetComparisonPair(
  left: string,
  right: string,
): boolean {
  return ATMOSPHERIC_DATASET_COMPARISON_PAIRS.some(
    ([candidateLeft, candidateRight]) =>
      candidateLeft === left && candidateRight === right,
  );
}

export const ATMOSPHERIC_RUN_COMPARISON_DATASET_IDS = ["gfs", "gefs", "ifs", "ifs-ens"] as const;

export const compareAtmosphericRunsSchema = z.strictObject({
  dataset: z.enum(ATMOSPHERIC_RUN_COMPARISON_DATASET_IDS),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({ at: isoDateTimeSchema }),
  selection: atmosphericSelectionSchema,
  anchorRun: atmosphericRunSelectorSchema,
  gfsGrid: gfsGridSchema.optional(),
  cycles: z.number().int().min(2).max(6).default(3),
  ensemble: atmosphericEnsembleOptionsSchema.optional(),
  thresholdGte: z.number().optional(),
  cycleStrideHours: z.union([z.literal(6), z.literal(12)]).optional(),
}).superRefine((request, context) => {
  validateRunSelectorForDatasets(request.anchorRun, [request.dataset], ["anchorRun"], context);
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
    if (
      request.ensemble?.includeMembers !== undefined
      || request.ensemble?.maxMemberSamples !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["ensemble"],
        message: "Ensemble run comparison returns distribution shifts only; includeMembers/maxMemberSamples are not applicable",
      });
    }
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

const compareGfsGefsDatasetsSchema = z.strictObject({
  datasets: z.tuple([z.literal("gfs"), z.literal("gefs")]),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({ at: isoDateTimeSchema }),
  variable: z.string().min(1),
  pressureLevelHpa: z.number().positive(),
  run: atmosphericRunSelectorSchema,
  gfsGrid: gfsGridSchema.optional(),
  members: z.array(z.string().min(1)).min(2).max(31).optional(),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).optional(),
  gefsMembers: z.never().optional(),
  aigefsMembers: z.never().optional(),
  ifsEnsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
  thresholdGte: z.never().optional(),
}).superRefine((request, context) => {
  validateRunSelectorForDatasets(request.run, request.datasets, ["run"], context);
});

const compareGfsIfsDatasetsSchema = z.strictObject({
  datasets: z.tuple([z.literal("gfs"), z.literal("ifs")]),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({ at: isoDateTimeSchema }),
  variable: ifsPressureVariableSchema,
  pressureLevelHpa: ifsPressureLevelSchema,
  run: atmosphericRunSelectorSchema,
  gfsGrid: gfsGridSchema.optional(),
  members: z.never().optional(),
  gefsMembers: z.never().optional(),
  aigefsMembers: z.never().optional(),
  ifsEnsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
  quantiles: z.never().optional(),
  thresholdGte: z.never().optional(),
}).superRefine((request, context) => {
  validateRunSelectorForDatasets(request.run, request.datasets, ["run"], context);
});

export const compareGefsIfsEnsDatasetsSchema = z.strictObject({
  datasets: z.tuple([z.literal("gefs"), z.literal("ifs-ens")]),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({ at: isoDateTimeSchema }),
  variable: gefsIfsEnsComparisonVariableSchema,
  pressureLevelHpa: ifsPressureLevelSchema,
  run: atmosphericRunSelectorSchema,
  gefsMembers: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length).optional(),
  ifsEnsMembers: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).optional(),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).optional(),
  thresholdGte: z.number().optional(),
  gfsGrid: z.never().optional(),
  members: z.never().optional(),
  aigefsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
}).superRefine((request, context) => {
  validateRunSelectorForDatasets(request.run, request.datasets, ["run"], context);
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

export const compareIfsIfsEnsDatasetsSchema = z.strictObject({
  datasets: z.tuple([z.literal("ifs"), z.literal("ifs-ens")]),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({ at: isoDateTimeSchema }),
  variable: ifsIfsEnsComparisonVariableSchema,
  pressureLevelHpa: ifsPressureLevelSchema,
  run: atmosphericRunSelectorSchema,
  ifsEnsMembers: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).optional(),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).optional(),
  gfsGrid: z.never().optional(),
  members: z.never().optional(),
  gefsMembers: z.never().optional(),
  aigefsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
  thresholdGte: z.never().optional(),
}).superRefine((request, context) => {
  validateRunSelectorForDatasets(request.run, request.datasets, ["run"], context);
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

/**
 * Pair-specific contracts, keyed by the registered `left↔right` ordering.
 * Every registered pair in ATMOSPHERIC_DATASET_COMPARISON_PAIRS must have one entry.
 */
const DATASET_COMPARISON_PAIR_SCHEMAS: ReadonlyMap<string, z.ZodType> = new Map<string, z.ZodType>([
  [pairKey("gfs", "gefs"), compareGfsGefsDatasetsSchema],
  [pairKey("gfs", "ifs"), compareGfsIfsDatasetsSchema],
  [pairKey("gefs", "ifs-ens"), compareGefsIfsEnsDatasetsSchema],
  [pairKey("ifs", "ifs-ens"), compareIfsIfsEnsDatasetsSchema],
  [pairKey("gfs", "aigfs"), compareGfsAigfsDatasetsSchema],
  [pairKey("ifs", "aifs"), compareIfsAifsDatasetsSchema],
  [pairKey("aigfs", "aifs"), compareAigfsAifsDatasetsSchema],
  [pairKey("gefs", "aigefs"), compareGefsAigefsDatasetsSchema],
  [pairKey("ifs-ens", "aifs-ens"), compareIfsEnsAifsEnsDatasetsSchema],
  [pairKey("hgefs", "gefs"), compareHgefsGefsDatasetsSchema],
  [pairKey("hgefs", "aigefs"), compareHgefsAigefsDatasetsSchema],
  [pairKey("ifs", "icon-d2"), compareIfsIconD2DatasetsSchema],
  [pairKey("ifs", "arome"), compareIfsAromeDatasetsSchema],
  [pairKey("gfs", "icon-d2"), compareGfsIconD2DatasetsSchema],
  [pairKey("ifs-ens", "icon-d2-eps"), compareIfsEnsIconD2EpsDatasetsSchema],
  [pairKey("ifs-ens", "pe-arome"), compareIfsEnsPeAromeDatasetsSchema],
]);

function pairKey(left: string, right: string): string {
  return `${left}↔${right}`;
}

/**
 * Discovery-facing description of every pair contract. Suitable for JSON Schema
 * generation (MCP tool listing); validation goes through
 * compareAtmosphericDatasetsSchema so failures name the pair contract that rejected them.
 */
export const compareAtmosphericDatasetsInputSchema = z.union([
  compareGfsGefsDatasetsSchema,
  compareGfsIfsDatasetsSchema,
  compareGefsIfsEnsDatasetsSchema,
  compareIfsIfsEnsDatasetsSchema,
  compareGfsAigfsDatasetsSchema,
  compareIfsAifsDatasetsSchema,
  compareAigfsAifsDatasetsSchema,
  compareGefsAigefsDatasetsSchema,
  compareIfsEnsAifsEnsDatasetsSchema,
  compareHgefsGefsDatasetsSchema,
  compareHgefsAigefsDatasetsSchema,
  compareIfsIconD2DatasetsSchema,
  compareIfsAromeDatasetsSchema,
  compareGfsIconD2DatasetsSchema,
  compareIfsEnsIconD2EpsDatasetsSchema,
  compareIfsEnsPeAromeDatasetsSchema,
]);

/**
 * Dispatches on `datasets` to exactly one registered pair contract instead of
 * trying sixteen alternatives blindly. A plain union reports "Invalid input" for
 * any mistake; this reports the offending field under the contract the caller
 * actually selected, and names the registered pairs when the pair itself is wrong.
 */
export const compareAtmosphericDatasetsSchema = z.any().transform((input, context) => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    context.addIssue({
      code: "custom",
      message: "compare_datasets expects an object request with datasets, geometry, time and a pair-specific selection",
    });
    return z.NEVER;
  }

  const rawDatasets = (input as { datasets?: unknown }).datasets;
  const registeredPairs = ATMOSPHERIC_DATASET_COMPARISON_PAIRS
    .map(([left, right]) => pairKey(left, right))
    .join(", ");
  let datasets: readonly [string, string];
  if (rawDatasets === undefined) {
    context.addIssue({
      code: "custom",
      path: ["datasets"],
      message: `datasets is required: name the registered [left, right] pair explicitly. Registered pairs: ${registeredPairs}`,
    });
    return z.NEVER;
  } else if (
    Array.isArray(rawDatasets)
    && rawDatasets.length === 2
    && rawDatasets.every((entry) => typeof entry === "string")
  ) {
    datasets = [rawDatasets[0] as string, rawDatasets[1] as string];
  } else {
    context.addIssue({
      code: "custom",
      path: ["datasets"],
      message: `datasets must be a [left, right] pair of dataset IDs from the registered comparison pairs: ${registeredPairs}`,
    });
    return z.NEVER;
  }

  const schema = DATASET_COMPARISON_PAIR_SCHEMAS.get(pairKey(datasets[0], datasets[1]));
  if (schema === undefined) {
    const reversed = DATASET_COMPARISON_PAIR_SCHEMAS.has(pairKey(datasets[1], datasets[0]));
    context.addIssue({
      code: "custom",
      path: ["datasets"],
      message: reversed
        ? `${pairKey(datasets[0], datasets[1])} is registered as ${pairKey(datasets[1], datasets[0])}; datasets is ordered [left, right] exactly as registered`
        : `Unsupported comparison pair: ${pairKey(datasets[0], datasets[1])}. Registered pairs: ${registeredPairs}`,
    });
    return z.NEVER;
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const pair = pairKey(datasets[0], datasets[1]);
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: "custom",
        path: [...issue.path] as (string | number)[],
        message: `${issue.message} (${pair} comparison)`,
      });
    }
    return z.NEVER;
  }
  return parsed.data as z.infer<typeof compareAtmosphericDatasetsInputSchema>;
}) as unknown as z.ZodType<
  z.infer<typeof compareAtmosphericDatasetsInputSchema>,
  z.input<typeof compareAtmosphericDatasetsInputSchema>
>;

const verifyAtmosphericForecastCaseSchema = z.strictObject({
  forecastDataset: z.literal("gfs").default("gfs"),
  referenceDataset: z.enum(["gfs-analysis", "igra"]).default("gfs-analysis"),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({ at: isoDateTimeSchema }),
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

const verifyAtmosphericForecastSkillSchema = z.strictObject({
  forecastDataset: z.literal("gfs").default("gfs"),
  referenceDataset: z.enum(["gfs-analysis", "igra"]).default("gfs-analysis"),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({
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

function validateRunSelectorForDatasets(
  run: string,
  datasets: readonly ("gfs" | "gefs" | "ifs" | "ifs-ens")[],
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  const selector = run === "latest" || run === "latest_complete" ? run : "explicit";
  const unsupported = datasets.filter(
    (dataset) => !publicDatasetCapabilities(dataset).runSelectors.includes(selector),
  );
  if (unsupported.length === 0) return;
  context.addIssue({
    code: "custom",
    path,
    message: `run=${run} is not supported by dataset(s): ${unsupported.join(", ")}; use a selector supported by every compared dataset`,
  });
}

/** Discovery-facing description of both verification forms (atomic case, skill summary). */
export const verifyAtmosphericForecastInputSchema = z.union([
  verifyAtmosphericForecastCaseSchema,
  verifyAtmosphericForecastSkillSchema,
]);

/**
 * Dispatches on the time form: `time.at` selects the atomic case contract,
 * `time.from`/`time.to` the skill-summary contract. Errors then name the field
 * inside the chosen form instead of a union-wide "Invalid input".
 */
export const verifyAtmosphericForecastSchema = z.any().transform((input, context) => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    context.addIssue({
      code: "custom",
      message: "verify_forecast expects an object request with geometry, time, leadHours, variables and pressureLevelsHpa",
    });
    return z.NEVER;
  }
  const time = (input as { time?: unknown }).time;
  if (typeof time !== "object" || time === null) {
    context.addIssue({
      code: "custom",
      path: ["time"],
      message: "time must be { at } for one verification case or { from, to } for a skill summary",
    });
    return z.NEVER;
  }
  const hasAt = (time as { at?: unknown }).at !== undefined;
  const hasRange = (time as { from?: unknown }).from !== undefined
    || (time as { to?: unknown }).to !== undefined;
  if (hasAt === hasRange) {
    context.addIssue({
      code: "custom",
      path: ["time"],
      message: "Choose exactly one time form: time.at for one verification case, or time.from plus time.to for a skill summary",
    });
    return z.NEVER;
  }

  const form = hasAt ? "atomic" : "skill-summary";
  const parsed = (hasAt ? verifyAtmosphericForecastCaseSchema : verifyAtmosphericForecastSkillSchema)
    .safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: "custom",
        path: [...issue.path] as (string | number)[],
        message: `${issue.message} (${form} verification)`,
      });
    }
    return z.NEVER;
  }
  return parsed.data as z.infer<typeof verifyAtmosphericForecastInputSchema>;
}) as unknown as z.ZodType<
  z.infer<typeof verifyAtmosphericForecastInputSchema>,
  z.input<typeof verifyAtmosphericForecastInputSchema>
>;

export const findAtmosphericAnalogsSchema = z.strictObject({
  dataset: z.literal("gfs-analysis").default("gfs-analysis"),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({ at: isoDateTimeSchema }),
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
export type CompareAtmosphericRunsRequest = z.infer<typeof compareAtmosphericRunsSchema>;
export type CompareAtmosphericDatasetsInput = z.input<typeof compareAtmosphericDatasetsSchema>;
export type CompareAtmosphericDatasetsRequest = z.infer<typeof compareAtmosphericDatasetsSchema>;
export type VerifyAtmosphericForecastInput = z.input<typeof verifyAtmosphericForecastSchema>;
export type VerifyAtmosphericForecastRequest = z.infer<typeof verifyAtmosphericForecastSchema>;
export type FindAtmosphericAnalogsInput = z.input<typeof findAtmosphericAnalogsSchema>;
export type FindAtmosphericAnalogsRequest = z.infer<typeof findAtmosphericAnalogsSchema>;
export type UnifiedSpecializedResult = z.infer<typeof unifiedSpecializedResultSchema>;
