import { sortGefsMembers } from "../catalog/gefs.js";
import { sortIfsEnsMembers } from "../catalog/ifs-ens.js";
import type {
  GefsMemberBundleQueryInput,
  GefsMemberBundleResult,
} from "../schema/gefs-member-bundle.js";
import {
  gefsIfsEnsComparisonQuerySchema,
  gefsIfsEnsComparisonResultSchema,
  type GefsIfsEnsComparisonQueryInput,
  type GefsIfsEnsComparisonResult,
} from "../schema/gefs-ifs-ens-comparison.js";
import type {
  IfsEnsMemberBundleQueryInput,
  IfsEnsMemberBundleResult,
} from "../schema/ifs-ens.js";
import { GefsMemberBundleService } from "./gefs-member-bundle.js";
import {
  GefsIfsEnsAlignedRunResolver,
  type GefsIfsEnsAlignedRunProvider,
} from "./gefs-ifs-ens-aligned-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";
import { IfsEnsMemberBundleService } from "./ifs-ens-member-bundle.js";
import { ifsEnsForecastHour, parseIfsRun } from "./ifs-time.js";

export interface GefsComparisonBundleGetter {
  getBundle(query: GefsMemberBundleQueryInput): Promise<GefsMemberBundleResult>;
}

export interface IfsEnsComparisonBundleGetter {
  getBundle(query: IfsEnsMemberBundleQueryInput): Promise<IfsEnsMemberBundleResult>;
}

export interface GefsIfsEnsComparisonServiceOptions {
  gefsBundleGetter?: GefsComparisonBundleGetter;
  ifsEnsBundleGetter?: IfsEnsComparisonBundleGetter;
  alignedRunProvider?: GefsIfsEnsAlignedRunProvider;
}

export class GefsIfsEnsComparisonService {
  private readonly gefsBundleGetter: GefsComparisonBundleGetter;
  private readonly ifsEnsBundleGetter: IfsEnsComparisonBundleGetter;
  private readonly alignedRunProvider: GefsIfsEnsAlignedRunProvider;

  constructor(options: GefsIfsEnsComparisonServiceOptions = {}) {
    this.gefsBundleGetter = options.gefsBundleGetter ?? new GefsMemberBundleService();
    this.ifsEnsBundleGetter = options.ifsEnsBundleGetter ?? new IfsEnsMemberBundleService();
    this.alignedRunProvider = options.alignedRunProvider ?? new GefsIfsEnsAlignedRunResolver();
  }

  async compare(input: GefsIfsEnsComparisonQueryInput): Promise<GefsIfsEnsComparisonResult> {
    const query = gefsIfsEnsComparisonQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const gefsMembers = sortGefsMembers(query.gefsMembers);
    const ifsEnsMembers = sortIfsEnsMembers(query.ifsEnsMembers);
    const quantiles = [...query.quantiles].sort((left, right) => left - right);

    const run = query.run === "latest"
      ? await this.alignedRunProvider.resolveLatestAlignedRun(
          validTime,
          query.variable,
          query.pressureLevelHpa,
          gefsMembers,
          ifsEnsMembers,
        )
      : parseSharedRun(query.run);
    const runIso = run.toISOString();

    const gefsHour = gefsForecastHour(run, validTime);
    // Validate that the same lead is also native to IFS ENS; both helpers compute
    // the same time difference once their model-specific cadence checks pass.
    ifsEnsForecastHour(run, validTime);

    const includeMembers = query.thresholdGte !== undefined;
    const [gefs, ifsEns] = await Promise.all([
      this.gefsBundleGetter.getBundle({
        latitude: query.latitude,
        longitude: query.longitude,
        run: runIso,
        validTime: query.validTime,
        selection: {
          variables: [query.variable],
          pressureLevelsHpa: [query.pressureLevelHpa],
          fields: [],
        },
        members: gefsMembers,
        quantiles,
        includeMembers,
      }),
      this.ifsEnsBundleGetter.getBundle({
        latitude: query.latitude,
        longitude: query.longitude,
        run: runIso,
        validTime: query.validTime,
        selection: {
          variables: [query.variable],
          pressureLevelsHpa: [query.pressureLevelHpa],
          fields: [],
        },
        members: ifsEnsMembers,
        quantiles,
        includeMembers,
      }),
    ]);

    assertAlignedMetadata(gefs, ifsEns, runIso);
    const gefsSummary = requiredGefsSummary(gefs, query.variable, query.pressureLevelHpa);
    const ifsSummary = requiredIfsSummary(
      ifsEns,
      query.variable,
      query.pressureLevelHpa,
      gefsSummary.outputField,
      gefsSummary.unit,
    );

    const quantileShifts = quantiles.map((quantile) => {
      const gefsValue = requiredQuantile(gefsSummary.distribution.quantiles, quantile, "GEFS");
      const ifsEnsValue = requiredQuantile(ifsSummary.distribution.quantiles, quantile, "IFS ENS");
      return {
        quantile,
        gefsValue,
        ifsEnsValue,
        ifsEnsMinusGefs: ifsEnsValue - gefsValue,
      };
    });

    const threshold = query.thresholdGte === undefined
      ? undefined
      : compareThresholdFractions(
          gefs,
          ifsEns,
          query.variable,
          query.pressureLevelHpa,
          gefsSummary.outputField,
          query.thresholdGte,
        );

    return gefsIfsEnsComparisonResultSchema.parse({
      run: runIso,
      validTime: query.validTime,
      forecastHour: gefsHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      selection: {
        variable: query.variable,
        pressureLevelHpa: query.pressureLevelHpa,
        outputField: gefsSummary.outputField,
        unit: gefsSummary.unit,
      },
      gefs: {
        model: gefs.model,
        gridPoint: gefs.gridPoint,
        summary: gefsSummary.distribution,
        source: gefs.source,
      },
      ifsEns: {
        model: ifsEns.model,
        gridPoint: ifsEns.gridPoint,
        summary: ifsSummary.distribution,
        source: ifsEns.source,
      },
      comparison: {
        ifsEnsMinusGefsMean: ifsSummary.distribution.mean - gefsSummary.distribution.mean,
        ifsEnsMinusGefsPopulationStdDev:
          ifsSummary.distribution.populationStdDev - gefsSummary.distribution.populationStdDev,
        populationStdDevRatioIfsEnsToGefs: gefsSummary.distribution.populationStdDev === 0
          ? null
          : ifsSummary.distribution.populationStdDev / gefsSummary.distribution.populationStdDev,
        quantileShifts,
        ...(threshold === undefined ? {} : { threshold }),
        interpretation:
          "independent_raw_ensemble_distributions_no_member_pairing_not_calibrated_uncertainty",
      },
    });
  }
}

function parseSharedRun(value: string): Date {
  const gefs = parseGefsRun(value);
  // Apply ECMWF's exact-cycle validation too; the timestamp itself is shared.
  parseIfsRun(value);
  return gefs;
}

function assertAlignedMetadata(
  gefs: GefsMemberBundleResult,
  ifsEns: IfsEnsMemberBundleResult,
  runIso: string,
): void {
  if (gefs.run !== runIso || ifsEns.run !== runIso) {
    throw new Error("GEFS/IFS ENS comparison received data from inconsistent initialization cycles");
  }
  if (gefs.validTime !== ifsEns.validTime || gefs.forecastHour !== ifsEns.forecastHour) {
    throw new Error("GEFS/IFS ENS comparison received inconsistent valid-time semantics");
  }
}

function requiredGefsSummary(
  result: GefsMemberBundleResult,
  variable: GefsIfsEnsComparisonQueryInput["variable"],
  pressureLevelHpa: number,
) {
  const summary = result.pressureSummaries.find((candidate) =>
    candidate.variable === variable && candidate.pressureLevelHpa === pressureLevelHpa,
  );
  if (!summary) throw new Error(`GEFS comparison is missing ${variable}@${pressureLevelHpa}hPa`);
  return summary;
}

function requiredIfsSummary(
  result: IfsEnsMemberBundleResult,
  variable: GefsIfsEnsComparisonQueryInput["variable"],
  pressureLevelHpa: number,
  outputField: string,
  unit: string,
) {
  const pressure = result.pressureSummaries.find((candidate) =>
    candidate.variable === variable && candidate.pressureLevelHpa === pressureLevelHpa,
  );
  if (!pressure) throw new Error(`IFS ENS comparison is missing ${variable}@${pressureLevelHpa}hPa`);
  const output = pressure.outputs.find((candidate) =>
    candidate.aggregation === "numeric_distribution" && candidate.field === outputField,
  );
  if (!output || output.aggregation !== "numeric_distribution") {
    throw new Error(`IFS ENS comparison is missing numeric output ${outputField}`);
  }
  if (output.unit !== unit) {
    throw new Error(`GEFS/IFS ENS comparison output unit mismatch for ${outputField}: ${unit} vs ${output.unit}`);
  }
  return output;
}

function requiredQuantile(
  quantiles: readonly { quantile: number; value: number }[],
  requested: number,
  model: string,
): number {
  const match = quantiles.find((candidate) => candidate.quantile === requested);
  if (!match) throw new Error(`${model} comparison summary is missing quantile ${requested}`);
  return match.value;
}

function compareThresholdFractions(
  gefs: GefsMemberBundleResult,
  ifsEns: IfsEnsMemberBundleResult,
  variable: GefsIfsEnsComparisonQueryInput["variable"],
  pressureLevelHpa: number,
  outputField: string,
  threshold: number,
) {
  if (!gefs.members || !ifsEns.members) {
    throw new Error("GEFS/IFS ENS threshold comparison requires internal member payloads");
  }
  const gefsValues = gefs.members.map((sample) => {
    const value = sample.pressureValues.find((candidate) =>
      candidate.variable === variable && candidate.pressureLevelHpa === pressureLevelHpa,
    )?.value;
    if (value === undefined) throw new Error(`GEFS ${sample.member} is missing comparison value`);
    return value;
  });
  const ifsValues = ifsEns.members.map((sample) => {
    const values = sample.pressureValues.find((candidate) =>
      candidate.variable === variable && candidate.pressureLevelHpa === pressureLevelHpa,
    )?.values;
    const value = values?.[outputField];
    if (value === undefined) throw new Error(`IFS ENS ${sample.member} is missing comparison value`);
    return value;
  });
  const gefsCount = gefsValues.filter((value) => value >= threshold).length;
  const ifsEnsCount = ifsValues.filter((value) => value >= threshold).length;
  const gefsFraction = gefsCount / gefsValues.length;
  const ifsEnsFraction = ifsEnsCount / ifsValues.length;
  return {
    operator: "gte" as const,
    value: threshold,
    gefsCount,
    gefsFraction,
    ifsEnsCount,
    ifsEnsFraction,
    ifsEnsMinusGefsFraction: ifsEnsFraction - gefsFraction,
    interpretation: "raw_member_fractions_not_calibrated_probabilities" as const,
  };
}
