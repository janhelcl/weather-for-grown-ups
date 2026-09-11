import { InvalidRequestError, WfgError, toPublicFailure, type PublicFailure } from "../failure.js";
import {
  alignAtmosphereResultSchema,
  alignAtmosphereSchema,
  type AlignAtmosphereInput,
  type AlignAtmosphereRequest,
  type AlignAtmosphereResult,
  type AlignedCell,
  type AlignmentSource,
} from "../schema/unified-alignment.js";
import {
  publicDatasetCapabilities,
  type QueryAtmosphereInput,
  type UnifiedAtmosphereResult,
} from "../schema/unified-api.js";
import type { PublicQueryAtmosphereInput } from "../schema/unified-query-input.js";
import {
  expandSelectionQuantities,
  readPointEvidence,
  type EvidenceStep,
  type PointEvidence,
  type QuantityDescriptor,
} from "./atmospheric-evidence.js";
import { mapConcurrent } from "./concurrency.js";
import { UnifiedAtmosphereQueryService } from "./unified-atmosphere-query.js";
import type { AtmosphericProgressReporter } from "./progress.js";

/**
 * Sources usually live on different providers, and every provider keeps its own
 * hard access ceiling in `src/access/`. This only bounds how many nested query
 * orchestrations run at once inside one alignment request.
 */
export const DEFAULT_ALIGNMENT_SOURCE_CONCURRENCY = 4;

export interface AlignmentQueryService {
  query(input: PublicQueryAtmosphereInput): Promise<UnifiedAtmosphereResult>;
}

export interface UnifiedAtmosphereAlignmentServiceOptions {
  queryService?: AlignmentQueryService;
  sourceConcurrency?: number;
  progress?: AtmosphericProgressReporter;
}

type SourceOutcome =
  | { status: "ok"; response: UnifiedAtmosphereResult; evidence: PointEvidence }
  | { status: "failed"; failure: PublicFailure };

/**
 * Composes `query_atmosphere` over several dataset/run/member selections and
 * joins the evidence by canonical quantity and valid time. Retrieval, provider
 * routing and member-first aggregation stay inside the query service; this layer
 * owns only the join and the alignment rules the caller cannot derive alone.
 */
export class UnifiedAtmosphereAlignmentService {
  private readonly queryService: AlignmentQueryService;
  private readonly sourceConcurrency: number;

  constructor(options: UnifiedAtmosphereAlignmentServiceOptions = {}) {
    this.queryService = options.queryService ?? new UnifiedAtmosphereQueryService({
      ...(options.progress === undefined ? {} : { progress: options.progress }),
    });
    this.sourceConcurrency = options.sourceConcurrency ?? DEFAULT_ALIGNMENT_SOURCE_CONCURRENCY;
  }

  async align(input: AlignAtmosphereInput): Promise<AlignAtmosphereResult> {
    const request = alignAtmosphereSchema.parse(input);
    const alignment = request.alignment ?? { initialization: "independent", validTimes: "intersection" };
    const quantities = expandSelectionQuantities(request.selection);
    const labels = sourceLabels(request.sources);

    const outcomes = await mapConcurrent(request.sources, this.sourceConcurrency, async (source): Promise<SourceOutcome> => {
      try {
        const response = await this.queryService.query(sourceQuery(request, source));
        return { status: "ok", response, evidence: readPointEvidence(response, quantities) };
      } catch (error) {
        return { status: "failed", failure: toPublicFailure(error) };
      }
    });

    const successful = outcomes.flatMap((outcome, index) =>
      outcome.status === "ok" ? [{ index, evidence: outcome.evidence }] : []);
    if (successful.length === 0) {
      throw allSourcesFailed(outcomes, labels);
    }

    const runs = successful.flatMap(({ index, evidence }) =>
      evidence.run === undefined ? [] : [{ label: labels[index]!, run: evidence.run }]);
    const distinctRuns = [...new Set(runs.map((entry) => canonicalTime(entry.run)))];
    if (alignment.initialization === "shared" && distinctRuns.length > 1) {
      throw sharedInitializationViolation(runs, distinctRuns);
    }

    const axis = validTimeAxis(successful.map(({ evidence }) => evidence), alignment.validTimes);
    const stepIndex = successful.map(({ index, evidence }) => ({
      index,
      steps: new Map(evidence.steps.map((step) => [canonicalTime(step.validTime), step])),
    }));

    return alignAtmosphereResultSchema.parse({
      operation: "align_atmosphere",
      geometry: request.geometry,
      time: "at" in request.time
        ? { at: request.time.at }
        : { from: request.time.from, to: request.time.to },
      selection: request.selection,
      alignment: {
        initialization: alignment.initialization,
        runs,
        sharedInitialization: distinctRuns.length <= 1,
        validTimes: alignment.validTimes,
        spatial: "each_source_samples_its_own_native_grid_at_the_requested_coordinate_no_regridding",
        ensembles: "independent_member_first_distributions_no_member_pairing",
        interpretation: "aligned_raw_model_evidence_not_error_not_calibrated_uncertainty",
      },
      sources: request.sources.map((source, index) =>
        publicSource(source, index, labels[index]!, outcomes[index]!)),
      quantities: quantities.map((quantity) => ({
        selection: quantity.selection,
        output: quantity.output,
        series: axis.map((validTime) => alignedStep(validTime, quantity, outcomes, stepIndex)),
      })),
    });
  }
}

function sourceQuery(request: AlignAtmosphereRequest, source: AlignmentSource): QueryAtmosphereInput {
  return {
    dataset: source.dataset,
    geometry: request.geometry,
    time: request.time,
    selection: request.selection,
    ...(source.forecast === undefined ? {} : { forecast: source.forecast }),
    ...(source.ensemble === undefined ? {} : { ensemble: source.ensemble }),
    ...(source.source === undefined ? {} : { source: source.source }),
  };
}

/**
 * Default labels stay short: the dataset ID alone, or `dataset@run` when one
 * dataset appears several times (the normal run-to-run case). Explicit labels
 * always win; any residual collision is disambiguated with the source index.
 */
export function sourceLabels(sources: readonly AlignmentSource[]): string[] {
  const datasetCounts = new Map<string, number>();
  for (const source of sources) {
    datasetCounts.set(source.dataset, (datasetCounts.get(source.dataset) ?? 0) + 1);
  }
  const explicit = new Set(sources.flatMap((source) => (source.label === undefined ? [] : [source.label])));
  const used = new Set<string>();
  return sources.map((source, index) => {
    if (source.label !== undefined) {
      used.add(source.label);
      return source.label;
    }
    const base = (datasetCounts.get(source.dataset) ?? 0) > 1
      ? `${source.dataset}@${source.forecast?.run ?? "latest"}`
      : source.dataset;
    const label = used.has(base) || explicit.has(base) ? `${base}#${index}` : base;
    used.add(label);
    return label;
  });
}

function validTimeAxis(evidences: readonly PointEvidence[], mode: "intersection" | "union"): string[] {
  const counts = new Map<string, { canonical: string; original: string; count: number }>();
  for (const evidence of evidences) {
    const seen = new Set<string>();
    for (const step of evidence.steps) {
      const canonical = canonicalTime(step.validTime);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      const entry = counts.get(canonical);
      if (entry === undefined) {
        counts.set(canonical, { canonical, original: step.validTime, count: 1 });
      } else {
        entry.count += 1;
      }
    }
  }
  return [...counts.values()]
    .filter((entry) => mode === "union" || entry.count === evidences.length)
    .sort((a, b) => a.canonical.localeCompare(b.canonical))
    .map((entry) => entry.original);
}

function alignedStep(
  validTime: string,
  quantity: QuantityDescriptor,
  outcomes: readonly SourceOutcome[],
  stepIndex: readonly { index: number; steps: ReadonlyMap<string, EvidenceStep> }[],
) {
  const canonical = canonicalTime(validTime);
  const values: AlignedCell[] = outcomes.map((outcome, index) => {
    if (outcome.status === "failed") return { kind: "unavailable", reason: "source_failed" };
    const step = stepIndex.find((entry) => entry.index === index)?.steps.get(canonical);
    if (step === undefined) return { kind: "unavailable", reason: "valid_time_not_sampled" };
    return step.cells.get(quantity.key) ?? { kind: "unavailable", reason: "output_missing" };
  });
  const windows = new Set(
    values
      .filter((cell) => cell.kind !== "unavailable")
      .map((cell) => JSON.stringify("window" in cell && cell.window !== undefined ? cell.window : null)),
  );
  const comparable = windows.size <= 1;
  return {
    validTime,
    values,
    comparable,
    ...(comparable ? {} : { reason: "temporal_windows_differ" as const }),
  };
}

function publicSource(
  source: AlignmentSource,
  index: number,
  label: string,
  outcome: SourceOutcome,
) {
  const requested = {
    ...(source.forecast === undefined ? {} : { forecast: source.forecast }),
    ...(source.ensemble === undefined
      ? {}
      : {
          ensemble: {
            ...(source.ensemble.members === undefined ? {} : { members: source.ensemble.members }),
            ...(source.ensemble.quantiles === undefined ? {} : { quantiles: source.ensemble.quantiles }),
          },
        }),
    ...(source.source === undefined ? {} : { source: source.source }),
  };
  if (outcome.status === "failed") {
    return { index, label, dataset: source.dataset, requested, status: "failed", failure: outcome.failure };
  }
  const capabilities = publicDatasetCapabilities(source.dataset, source.forecast?.kind);
  const { response, evidence } = outcome;
  return {
    index,
    label,
    dataset: source.dataset,
    requested,
    status: "ok",
    internalDatasetId: response.internalDatasetId,
    role: response.role,
    kind: response.kind,
    modelClass: capabilities.modelClass,
    provider: capabilities.provider,
    ...(evidence.model === undefined ? {} : { model: evidence.model }),
    ...(evidence.run === undefined ? {} : { run: evidence.run }),
    ...(evidence.memberCount === undefined ? {} : { memberCount: evidence.memberCount }),
    ...(evidence.gridPoint === undefined ? {} : { gridPoint: evidence.gridPoint }),
    spatialDomain: capabilities.spatialDomain,
    nativeGrid: capabilities.nativeGrid,
    steps: evidence.steps.map((step) => ({
      validTime: step.validTime,
      ...(step.forecastHour === undefined ? {} : { forecastHour: step.forecastHour }),
      ...(step.gridPoint === undefined ? {} : { gridPoint: step.gridPoint }),
    })),
    source: evidence.source,
  };
}

function allSourcesFailed(outcomes: readonly SourceOutcome[], labels: readonly string[]): WfgError {
  const failures = outcomes.flatMap((outcome, index) =>
    outcome.status === "failed" ? [{ label: labels[index]!, ...outcome.failure }] : []);
  const first = failures[0]!;
  const summary = failures.map((failure) => `${failure.label}: ${failure.message}`).join(" | ");
  return new WfgError(first.code, `Every alignment source failed. ${summary}`, {
    retryable: failures.every((failure) => failure.retryable),
    details: { sources: failures },
  });
}

function sharedInitializationViolation(
  runs: readonly { label: string; run: string }[],
  distinctRuns: readonly string[],
): InvalidRequestError {
  const oldest = [...distinctRuns].sort()[0]!;
  const listing = runs.map((entry) => `${entry.label}=${entry.run}`).join(", ");
  return new InvalidRequestError(
    `alignment.initialization=shared, but sources resolved different initialization cycles: ${listing}. Set forecast.run explicitly on every source to one cycle they all publish, e.g. ${oldest}`,
    { details: { runs: [...runs], suggestedRun: oldest } },
  );
}

function canonicalTime(value: string): string {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}
