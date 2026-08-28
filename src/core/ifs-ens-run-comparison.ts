import {
  ifsEnsMemberNumber,
  sortIfsEnsMembers,
} from "../catalog/ifs-ens.js";
import {
  ifsEnsRunComparisonQuerySchema,
  ifsEnsRunComparisonResultSchema,
  type IfsEnsRunComparisonQueryInput,
  type IfsEnsRunComparisonResult,
} from "../schema/ifs-ens-run-comparison.js";
import type {
  IfsEnsMemberBundleQueryInput,
  IfsEnsMemberBundleResult,
} from "../schema/ifs-ens.js";
import { mapConcurrent } from "./concurrency.js";
import {
  IfsEnsLatestRunResolver,
  type IfsEnsLatestRunProvider,
} from "./ifs-ens-latest-run.js";
import { IfsEnsMemberBundleService } from "./ifs-ens-member-bundle.js";
import { ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import { parseIfsRun } from "./ifs-time.js";

export const DEFAULT_IFS_ENS_RUN_COMPARISON_CONCURRENCY = 2;

export interface IfsEnsRunComparisonBundleGetter {
  getBundle(query: IfsEnsMemberBundleQueryInput): Promise<IfsEnsMemberBundleResult>;
}

export interface IfsEnsRunComparisonServiceOptions {
  bundleGetter?: IfsEnsRunComparisonBundleGetter;
  latestRunProvider?: IfsEnsLatestRunProvider;
  concurrency?: number;
}

/**
 * Compare independently summarized IFS ENS distributions across model cycles.
 *
 * Perturbation labels are deliberately not treated as trajectories across
 * initializations. Each cycle is sampled and summarized independently; only
 * distribution descriptors are differenced newer - older.
 */
export class IfsEnsRunComparisonService {
  private readonly bundleGetter: IfsEnsRunComparisonBundleGetter;
  private readonly latestRunProvider: IfsEnsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: IfsEnsRunComparisonServiceOptions = {}) {
    this.bundleGetter = options.bundleGetter ?? new IfsEnsMemberBundleService();
    this.latestRunProvider = options.latestRunProvider ?? new IfsEnsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_IFS_ENS_RUN_COMPARISON_CONCURRENCY;
  }

  async compareRuns(input: IfsEnsRunComparisonQueryInput): Promise<IfsEnsRunComparisonResult> {
    const query = ifsEnsRunComparisonQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const baseSelectors = ifsIndexSelectorsForSelection({
      variables: [query.variable],
      pressureLevelsHpa: [query.pressureLevelHpa],
    });
    const availabilitySelectors = members.flatMap((member) => {
      const number = ifsEnsMemberNumber(member);
      return baseSelectors.map((selector) => ({ ...selector, number }));
    });

    const anchorRun = query.anchorRun === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, availabilitySelectors)
      : parseIfsRun(query.anchorRun);
    const strideMs = query.cycleStrideHours * 3_600_000;
    const runs = Array.from({ length: query.cycles }, (_, index) =>
      new Date(anchorRun.getTime() - (query.cycles - 1 - index) * strideMs));

    const snapshots = await mapConcurrent(runs, this.concurrency, async (run) => {
      let result: IfsEnsMemberBundleResult;
      try {
        result = await this.bundleGetter.getBundle({
          latitude: query.latitude,
          longitude: query.longitude,
          run: run.toISOString(),
          validTime: validTime.toISOString(),
          selection: {
            variables: [query.variable],
            pressureLevelsHpa: [query.pressureLevelHpa],
          },
          members,
          quantiles,
          includeMembers: query.thresholdGte !== undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Cannot compare IFS ENS run ${run.toISOString()} at ${validTime.toISOString()}: ${message}`,
        );
      }
      return summarizeSnapshot(result, query.thresholdGte);
    });

    const first = snapshots[0];
    if (!first) throw new Error("IFS ENS run comparison produced no ensemble snapshots");
    for (const [index, snapshot] of snapshots.entries()) {
      const expectedRun = runs[index]!.toISOString();
      assertSnapshotInvariant(
        snapshot.result,
        expectedRun,
        validTime.toISOString(),
        query.latitude,
        query.longitude,
        first.result,
      );
      if (
        snapshot.outputField !== first.outputField
        || snapshot.unit !== first.unit
      ) {
        throw new Error("IFS ENS scalar output changed across one run comparison");
      }
    }

    return ifsEnsRunComparisonResultSchema.parse({
      model: "ifs_ens_0p25",
      validTime: validTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.result.gridPoint,
      anchorRun: anchorRun.toISOString(),
      cycleStrideHours: query.cycleStrideHours,
      selection: {
        variable: query.variable,
        pressureLevelHpa: query.pressureLevelHpa,
        outputField: first.outputField,
        unit: first.unit,
        members,
        quantiles,
        ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
      },
      runs: snapshots.map((snapshot) => ({
        run: snapshot.result.run,
        forecastHour: snapshot.result.forecastHour,
        summary: snapshot.summary,
        allCacheHit: snapshot.result.source.allCacheHit,
      })),
      comparisons: snapshots.slice(1).map((newer, index) =>
        compareDistributions(snapshots[index]!, newer)),
      source: {
        provider: "ECMWF Open Data",
        access: "indexed_http_range",
        decoder: first.result.source.decoder,
        product: "ifs_0p25_enfo_ef",
        horizontalGridDegrees: 0.25,
        memberSemantics: "50_perturbed_members_control_is_oper_fc",
      },
    });
  }
}

interface Snapshot {
  result: IfsEnsMemberBundleResult;
  outputField: string;
  unit: string;
  summary: {
    memberCount: number;
    mean: number;
    populationStdDev: number;
    min: number;
    max: number;
    quantiles: Array<{ quantile: number; value: number }>;
    threshold?: {
      operator: "gte";
      value: number;
      count: number;
      fraction: number;
      interpretation: "raw_member_fraction_not_calibrated_probability";
    };
  };
}

function summarizeSnapshot(
  result: IfsEnsMemberBundleResult,
  thresholdGte: number | undefined,
): Snapshot {
  const pressure = result.pressureSummaries[0];
  if (!pressure || result.pressureSummaries.length !== 1 || result.fieldSummaries.length !== 0) {
    throw new Error("IFS ENS run comparison expected exactly one pressure-variable summary");
  }
  const output = pressure.outputs[0];
  if (!output || pressure.outputs.length !== 1 || output.aggregation !== "numeric_distribution") {
    throw new Error("IFS ENS run comparison expected exactly one numeric scalar output");
  }

  const threshold = thresholdGte === undefined
    ? undefined
    : thresholdSummary(result, output.field, thresholdGte);

  return {
    result,
    outputField: output.field,
    unit: output.unit,
    summary: {
      ...output.distribution,
      ...(threshold === undefined ? {} : { threshold }),
    },
  };
}

function thresholdSummary(
  result: IfsEnsMemberBundleResult,
  outputField: string,
  threshold: number,
) {
  const members = result.members;
  if (!members) {
    throw new Error("IFS ENS run comparison threshold requires member values from the bundle service");
  }
  const values = members.map((member) => {
    const sample = member.pressureValues[0];
    const value = sample?.values[outputField];
    if (value === undefined) {
      throw new Error(`IFS ENS run comparison member ${member.member} is missing ${outputField}`);
    }
    return value;
  });
  const count = values.filter((value) => value >= threshold).length;
  return {
    operator: "gte" as const,
    value: threshold,
    count,
    fraction: count / values.length,
    interpretation: "raw_member_fraction_not_calibrated_probability" as const,
  };
}

function assertSnapshotInvariant(
  result: IfsEnsMemberBundleResult,
  expectedRun: string,
  expectedValidTime: string,
  latitude: number,
  longitude: number,
  first: IfsEnsMemberBundleResult,
): void {
  if (result.run !== expectedRun) {
    throw new Error(
      `IFS ENS bundle service changed requested comparison run from ${expectedRun} to ${result.run}`,
    );
  }
  if (result.validTime !== expectedValidTime) {
    throw new Error("IFS ENS valid time changed across one run comparison");
  }
  if (
    result.requestedPoint.latitude !== latitude
    || result.requestedPoint.longitude !== longitude
  ) {
    throw new Error("IFS ENS requested point changed across one run comparison");
  }
  if (
    result.gridPoint.latitude !== first.gridPoint.latitude
    || result.gridPoint.longitude !== first.gridPoint.longitude
  ) {
    throw new Error("IFS ENS grid point changed across model cycles for one run comparison");
  }
  if (
    result.source.provider !== "ECMWF Open Data"
    || result.source.access !== "indexed_http_range"
    || result.source.product !== "ifs_0p25_enfo_ef"
    || result.source.horizontalGridDegrees !== 0.25
    || result.source.decoder !== first.source.decoder
    || result.source.memberSemantics !== first.source.memberSemantics
  ) {
    throw new Error("IFS ENS run comparison requires consistent ECMWF perturbed-ensemble provenance");
  }
}

function compareDistributions(older: Snapshot, newer: Snapshot) {
  const olderQuantiles = new Map(older.summary.quantiles.map((item) => [item.quantile, item.value]));
  const newerQuantiles = new Map(newer.summary.quantiles.map((item) => [item.quantile, item.value]));
  const quantiles = [...olderQuantiles.keys()].sort((a, b) => a - b).map((quantile) => {
    const from = olderQuantiles.get(quantile);
    const to = newerQuantiles.get(quantile);
    if (from === undefined || to === undefined) {
      throw new Error(`IFS ENS quantile ${quantile} changed across model cycles`);
    }
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
    fromRun: older.result.run,
    toRun: newer.result.run,
    fromForecastHour: older.result.forecastHour,
    toForecastHour: newer.result.forecastHour,
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
