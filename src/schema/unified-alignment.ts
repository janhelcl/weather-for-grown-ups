import * as z from "zod/v4";
import { NON_ISOBARIC_FIELD_CATALOG } from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import { PUBLIC_FAILURE_CODES } from "../failure.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";
import {
  UNIFIED_ATMOSPHERE_INTERNAL_DATASET_IDS,
  atmosphericEnsembleOptionsSchema,
  atmosphericForecastOptionsSchema,
  atmosphericSelectionSchema,
  atmosphericTimeSchema,
  publicAtmosphericDatasetSchema,
  validateDatasetModifiers,
} from "./unified-api.js";

/**
 * `align_atmosphere` asks one geometry × time × selection question of several
 * dataset/run/member selections at once and returns the evidence as one table
 * keyed by canonical quantity and valid time.
 *
 * WFG owns retrieval, canonical variable semantics, units, run/valid-time
 * provenance, grid metadata and the rules that decide whether two cells can be
 * differenced (linear vs circular quantities, matching accumulation windows,
 * shared or independent initialization). It does not compute or interpret
 * differences: which model is warmer, which guidance disagrees and whether the
 * disagreement matters remain the caller's statements.
 */

export const MAX_ALIGNMENT_SOURCES = 8;
export const MAX_ALIGNMENT_LABEL_LENGTH = 40;

/**
 * One source is the dataset-specific part of a `query_atmosphere` request: the
 * dataset plus its own forecast (run / kind / grid), ensemble and source modifiers.
 * Comparing runs of one model is therefore just two sources with the same dataset
 * and different `forecast.run` selectors; there is no separate run-comparison verb.
 */
export const alignmentSourceSchema = z.strictObject({
  dataset: publicAtmosphericDatasetSchema,
  label: z.string().min(1).max(MAX_ALIGNMENT_LABEL_LENGTH).optional().describe(
    "Caller-chosen handle echoed in the result. Defaults to the dataset ID, suffixed with the requested run when several sources share a dataset.",
  ),
  forecast: atmosphericForecastOptionsSchema.optional(),
  ensemble: atmosphericEnsembleOptionsSchema.optional(),
  source: z.enum(["nomads", "s3", "archive"]).optional().describe(
    "GFS-only source override; omit for automatic routing",
  ),
}).superRefine((source, context) => {
  if (
    source.ensemble?.includeMembers !== undefined
    || source.ensemble?.maxMemberSamples !== undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["ensemble"],
      message: "Alignment returns compact member-first distributions; includeMembers/maxMemberSamples are not applicable",
    });
  }
});

export const alignmentOptionsSchema = z.strictObject({
  initialization: z.enum(["independent", "shared"]).default("independent").describe(
    "independent: every source resolves its own run and the result reports each one. shared: every forecast source must resolve to the same initialization cycle, otherwise the request fails with the resolved runs so it can be repaired.",
  ),
  validTimes: z.enum(["intersection", "union"]).default("intersection").describe(
    "Time-range alignment axis. intersection: only valid times sampled by every successful source. union: every sampled valid time, with explicit not-sampled cells where a source has no native step.",
  ),
});

export const alignAtmosphereSchema = z.strictObject({
  sources: z.array(alignmentSourceSchema).min(2).max(MAX_ALIGNMENT_SOURCES).describe(
    "Dataset / run / member selections to align. Each entry is the dataset-specific part of a query_atmosphere request.",
  ),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: atmosphericTimeSchema,
  selection: atmosphericSelectionSchema,
  alignment: alignmentOptionsSchema.optional(),
}).superRefine((request, context) => {
  request.selection.variables?.forEach((variable, index) => {
    if (!Object.hasOwn(VARIABLE_CATALOG, variable)) {
      context.addIssue({
        code: "custom",
        path: ["selection", "variables", index],
        message: `Unknown canonical pressure variable "${variable}"; use search_catalog / wfg catalog for the shared vocabulary`,
      });
    }
  });
  request.selection.fields?.forEach((field, index) => {
    if (!Object.hasOwn(NON_ISOBARIC_FIELD_CATALOG, field)) {
      context.addIssue({
        code: "custom",
        path: ["selection", "fields", index],
        message: `Unknown canonical field "${field}"; use search_catalog / wfg catalog for the shared vocabulary`,
      });
    }
  });

  const seenLabels = new Map<string, number>();
  const seenSources = new Map<string, number>();
  request.sources.forEach((source, index) => {
    // Each source is validated by the query_atmosphere dataset rules. Only issues about
    // the source's own modifiers (forecast / ensemble / source) fail the request here:
    // they are malformed input with nothing to retrieve. A dataset that cannot serve the
    // shared selection or geometry is a legitimate answer to the question being asked, so
    // it is reported at execution time as an inline per-source failure instead of hiding
    // the evidence the other sources can provide.
    validateDatasetModifiers(
      { ...source, geometry: request.geometry, time: request.time, selection: request.selection },
      prefixedContext(context, ["sources", index], SOURCE_OWNED_PATHS),
    );
    if (source.label !== undefined) {
      const previous = seenLabels.get(source.label);
      if (previous !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "label"],
          message: `label "${source.label}" is already used by sources[${previous}]`,
        });
      }
      seenLabels.set(source.label, index);
    }
    const identity = sourceIdentity(source);
    const duplicate = seenSources.get(identity);
    if (duplicate !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["sources", index],
        message: `sources[${index}] selects the same dataset, forecast, ensemble and source as sources[${duplicate}]; vary forecast.run or ensemble.members to align different evidence`,
      });
    }
    seenSources.set(identity, index);
  });
});

const SOURCE_OWNED_PATHS: ReadonlySet<PropertyKey> = new Set(["forecast", "ensemble", "source"]);

function prefixedContext(
  context: z.RefinementCtx,
  prefix: PropertyKey[],
  keepRoots: ReadonlySet<PropertyKey>,
): z.RefinementCtx {
  return {
    ...context,
    addIssue: (issue) => {
      if (typeof issue === "string") return;
      const root = issue.path?.[0];
      if (root === undefined || !keepRoots.has(root)) return;
      context.addIssue({ ...issue, path: [...prefix, ...(issue.path ?? [])] });
    },
  } as z.RefinementCtx;
}

function sourceIdentity(source: z.output<typeof alignmentSourceSchema>): string {
  return JSON.stringify({
    dataset: source.dataset,
    forecast: source.forecast ?? null,
    ensemble: source.ensemble === undefined
      ? null
      : {
          members: source.ensemble.members === undefined ? null : [...source.ensemble.members].sort(),
          quantiles: source.ensemble.quantiles === undefined ? null : [...source.ensemble.quantiles].sort(),
        },
    source: source.source ?? null,
  });
}

/* ------------------------------------------------------------------------- */
/* Result contract                                                           */
/* ------------------------------------------------------------------------- */

const gridPointSchema = z.object({ latitude: z.number(), longitude: z.number() });

const publicFailureSchema = z.object({
  code: z.enum(PUBLIC_FAILURE_CODES),
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const alignedQuantitySelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pressure"),
    variable: z.string(),
    pressureLevelHpa: z.number(),
  }),
  z.object({
    kind: z.literal("field"),
    field: z.string(),
    temporalSemantics: z.enum(["instantaneous", "accumulation", "average", "maximum"]),
  }),
]);

export const alignedOutputSchema = z.object({
  field: z.string().describe("Canonical output key shared by every dataset, e.g. temperatureC"),
  unit: z.string(),
  deltaKind: z.enum(["linear", "circular_degrees"]).describe(
    "How two cells may be differenced: plain subtraction, or the shortest signed angle in [-180, 180) for meteorological directions",
  ),
});

const intervalWindowSchema = z.object({
  type: z.enum(["accumulation", "average", "maximum"]),
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
});

const distributionQuantileSchema = z.object({ quantile: z.number(), value: z.number() });

export const alignedCellSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("value"),
    value: z.number(),
    window: intervalWindowSchema.optional(),
  }),
  z.object({
    kind: z.literal("distribution"),
    memberCount: z.number().int(),
    mean: z.number(),
    populationStdDev: z.number(),
    min: z.number(),
    max: z.number(),
    quantiles: z.array(distributionQuantileSchema),
    window: intervalWindowSchema.optional(),
  }),
  z.object({
    kind: z.literal("circular_direction"),
    memberCount: z.number().int(),
    meanDirectionDeg: z.number(),
    resultantLength: z.number(),
    window: intervalWindowSchema.optional(),
  }),
  z.object({
    kind: z.literal("unavailable"),
    reason: z.enum(["source_failed", "valid_time_not_sampled", "output_missing"]),
  }),
]);

export const alignedStepSchema = z.object({
  validTime: isoDateTimeSchema,
  values: z.array(alignedCellSchema).describe("One cell per entry of sources, in request order"),
  comparable: z.boolean().describe(
    "false when the available cells describe different accumulation/average windows and must not be differenced",
  ),
  reason: z.literal("temporal_windows_differ").optional(),
});

export const alignedQuantitySchema = z.object({
  selection: alignedQuantitySelectionSchema,
  output: alignedOutputSchema,
  series: z.array(alignedStepSchema),
});

const alignedSourceCommonShape = {
  index: z.number().int(),
  label: z.string(),
  dataset: publicAtmosphericDatasetSchema,
  requested: z.object({
    forecast: atmosphericForecastOptionsSchema.optional(),
    ensemble: z.object({
      members: z.array(z.string()).optional(),
      quantiles: z.array(z.number()).optional(),
    }).optional(),
    source: z.enum(["nomads", "s3", "archive"]).optional(),
  }),
};

export const alignedSourceSchema = z.discriminatedUnion("status", [
  z.object({
    ...alignedSourceCommonShape,
    status: z.literal("ok"),
    internalDatasetId: z.enum(UNIFIED_ATMOSPHERE_INTERNAL_DATASET_IDS),
    role: z.enum(["forecast", "analysis"]),
    kind: z.enum(["deterministic", "ensemble"]),
    modelClass: z.string(),
    provider: z.string(),
    model: z.string().optional(),
    run: isoDateTimeSchema.optional(),
    memberCount: z.number().int().optional(),
    gridPoint: gridPointSchema.optional(),
    spatialDomain: z.unknown(),
    nativeGrid: z.unknown(),
    steps: z.array(z.object({
      validTime: isoDateTimeSchema,
      forecastHour: z.number().optional(),
      gridPoint: gridPointSchema.optional(),
    })).describe("Every valid time this source actually sampled, with its lead"),
    source: z.unknown().describe("Dataset-native provenance exactly as query_atmosphere reports it"),
  }),
  z.object({
    ...alignedSourceCommonShape,
    status: z.literal("failed"),
    failure: publicFailureSchema,
  }),
]);

export const alignAtmosphereResultSchema = z.object({
  operation: z.literal("align_atmosphere"),
  geometry: z.object({ type: z.literal("point"), latitude: z.number(), longitude: z.number() }),
  time: z.union([
    z.object({ at: isoDateTimeSchema }),
    z.object({ from: isoDateTimeSchema, to: isoDateTimeSchema }),
  ]),
  selection: z.object({
    variables: z.array(z.string()).optional(),
    pressureLevelsHpa: z.array(z.number()).optional(),
    fields: z.array(z.string()).optional(),
  }),
  alignment: z.object({
    initialization: z.enum(["independent", "shared"]),
    runs: z.array(z.object({ label: z.string(), run: isoDateTimeSchema })),
    sharedInitialization: z.boolean().describe(
      "true when every successful forecast source resolved to the same initialization cycle",
    ),
    validTimes: z.enum(["intersection", "union"]),
    spatial: z.literal("each_source_samples_its_own_native_grid_at_the_requested_coordinate_no_regridding"),
    ensembles: z.literal("independent_member_first_distributions_no_member_pairing"),
    interpretation: z.literal("aligned_raw_model_evidence_not_error_not_calibrated_uncertainty"),
  }),
  sources: z.array(alignedSourceSchema),
  quantities: z.array(alignedQuantitySchema),
});

export type AlignmentSource = z.output<typeof alignmentSourceSchema>;
export type AlignAtmosphereInput = z.input<typeof alignAtmosphereSchema>;
export type AlignAtmosphereRequest = z.output<typeof alignAtmosphereSchema>;
export type AlignAtmosphereResult = z.output<typeof alignAtmosphereResultSchema>;
export type AlignedCell = z.output<typeof alignedCellSchema>;
export type AlignedQuantity = z.output<typeof alignedQuantitySchema>;
export type AlignedQuantitySelection = z.output<typeof alignedQuantitySelectionSchema>;
export type AlignedOutput = z.output<typeof alignedOutputSchema>;
export type AlignedSource = z.output<typeof alignedSourceSchema>;
