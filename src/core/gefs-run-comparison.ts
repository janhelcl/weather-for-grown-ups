import { sortGefsMembers } from "../catalog/gefs.js";
import {
  gefsRunComparisonQuerySchema,
  gefsRunComparisonResultSchema,
  type GefsRunComparisonQueryInput,
  type GefsRunComparisonResult,
} from "../schema/gefs-run-comparison.js";
import type { GefsEnsembleQueryInput, GefsEnsembleResult } from "../schema/gefs-ensemble.js";
import { mapConcurrent } from "./concurrency.js";
import { GefsEnsembleService } from "./gefs-ensemble.js";
import { GefsLatestRunResolver, type GefsLatestRunProvider } from "./gefs-latest-run.js";
import { parseGefsRun } from "./gefs-time.js";

const GEFS_CYCLE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_GEFS_RUN_COMPARISON_CONCURRENCY = 2;

export interface GefsRunComparisonEnsembleGetter {
  getEnsemble(query: GefsEnsembleQueryInput): Promise<GefsEnsembleResult>;
}

export interface GefsRunComparisonServiceOptions {
  ensembleGetter?: GefsRunComparisonEnsembleGetter;
  latestRunProvider?: GefsLatestRunProvider;
  concurrency?: number;
}

/**
 * Compare the same GEFS distribution across consecutive six-hour cycles.
 *
 * Perturbed member labels are not treated as forecast trajectories across
 * initializations. Each cycle is summarized independently, then only
 * distribution descriptors are differenced newer - older.
 */
export class GefsRunComparisonService {
  private readonly ensembleGetter: GefsRunComparisonEnsembleGetter;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: GefsRunComparisonServiceOptions = {}) {
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.ensembleGetter = options.ensembleGetter ?? new GefsEnsembleService({
      latestRunProvider: this.latestRunProvider,
    });
    this.concurrency = options.concurrency ?? DEFAULT_GEFS_RUN_COMPARISON_CONCURRENCY;
  }

  async compareRuns(input: GefsRunComparisonQueryInput): Promise<GefsRunComparisonResult> {
    const query = gefsRunComparisonQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);

    const anchorRun = query.anchorRun === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.anchorRun);

    const runs = Array.from({ length: query.cycles }, (_, index) =>
      new Date(anchorRun.getTime() - (query.cycles - 1 - index) * GEFS_CYCLE_MS));

    const results = await mapConcurrent(runs, this.concurrency, async (run) => {
      try {
        return await this.ensembleGetter.getEnsemble({
          latitude: query.latitude,
          longitude: query.longitude,
          run: run.toISOString(),
          validTime: validTime.toISOString(),
          variable: query.variable,
          pressureLevelHpa: query.pressureLevelHpa,
          members,
          quantiles,
          ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot compare GEFS run ${run.toISOString()} at ${validTime.toISOString()}: ${message}`);
      }
    });

    const first = results[0];
    if (!first) throw new Error("GEFS run comparison produced no ensemble snapshots");

    for (const [index, result] of results.entries()) {
      const expectedRun = runs[index]!.toISOString();
      if (result.run !== expectedRun) throw new Error(`GEFS ensemble service changed requested comparison run from ${expectedRun} to ${result.run}`);
      if (result.validTime !== validTime.toISOString()) throw new Error("GEFS valid time changed across one run comparison");
      if (result.requestedPoint.latitude !== query.latitude || result.requestedPoint.longitude !== query.longitude) {
        throw new Error("GEFS requested point changed across one run comparison");
      }
      if (result.gridPoint.latitude !== first.gridPoint.latitude || result.gridPoint.longitude !== first.gridPoint.longitude) {
        throw new Error("GEFS grid point changed across model cycles for one run comparison");
      }
      if (result.selection.variable !== first.selection.variable
        || result.selection.pressureLevelHpa !== first.selection.pressureLevelHpa
        || result.selection.outputField !== first.selection.outputField
        || result.selection.unit !== first.selection.unit) {
        throw new Error("GEFS atmospheric selection changed across one run comparison");
      }
    }

    return gefsRunComparisonResultSchema.parse({
      model: "gefs_0p50",
      validTime: validTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      anchorRun: anchorRun.toISOString(),
      selection: {
        ...first.selection,
        members,
        quantiles,
        ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
      },
      runs: results.map((result) => ({
        run: result.run,
        forecastHour: result.forecastHour,
        summary: result.summary,
        allCacheHit: result.source.allCacheHit,
      })),
      comparisons: results.slice(1).map((newer, index) => compareDistributions(results[index]!, newer)),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: results[0]!.source.decoder,
        product: "pgrb2a_0p50",
      },
    });
  }
}

function compareDistributions(older: GefsEnsembleResult, newer: GefsEnsembleResult) {
  const olderQuantiles = new Map(older.summary.quantiles.map((item) => [item.quantile, item.value]));
  const newerQuantiles = new Map(newer.summary.quantiles.map((item) => [item.quantile, item.value]));
  const quantiles = [...olderQuantiles.keys()].sort((a, b) => a - b).map((quantile) => {
    const from = olderQuantiles.get(quantile);
    const to = newerQuantiles.get(quantile);
    if (from === undefined || to === undefined) throw new Error(`GEFS quantile ${quantile} changed across model cycles`);
    return { quantile, from, to, delta: to - from };
  });

  const thresholdFraction = older.summary.threshold && newer.summary.threshold
    ? {
        operator: "gte" as const,
        threshold: older.summary.threshold.value,
        from: older.summary.threshold.fraction,
        to: newer.summary.threshold.fraction,
        delta: newer.summary.threshold.fraction - older.summary.threshold.fraction,
      }
    : undefined;

  return {
    fromRun: older.run,
    toRun: newer.run,
    fromForecastHour: older.forecastHour,
    toForecastHour: newer.forecastHour,
    mean: shift(older.summary.mean, newer.summary.mean),
    populationStdDev: shift(older.summary.populationStdDev, newer.summary.populationStdDev),
    min: shift(older.summary.min, newer.summary.min),
    max: shift(older.summary.max, newer.summary.max),
    quantiles,
    ...(thresholdFraction === undefined ? {} : { thresholdFraction }),
    interpretation: "distribution_shift_between_model_cycles_not_member_trajectory" as const,
  };
}

function shift(from: number, to: number) {
  return { from, to, delta: to - from };
}
