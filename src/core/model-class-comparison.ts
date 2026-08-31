import { AIGEFS_MEMBERS } from "../catalog/aigefs.js";
import { AIFS_ENS_MEMBERS } from "../catalog/aifs-ens.js";
import { GEFS_MEMBERS } from "../catalog/gefs.js";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import {
  HGEFS_MEMBERS,
  type HgefsMember,
  type HgefsPopulation,
} from "../catalog/hgefs.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import type {
  PublicAtmosphericDataset,
  QueryAtmosphereInput,
  UnifiedAtmosphereResult,
} from "../schema/unified-api.js";
import { summarizeNumericDistribution } from "./ensemble-statistics.js";
import { UnifiedAtmosphereQueryService } from "./unified-atmosphere-query.js";

export interface ModelClassComparisonQueryService {
  query(input: QueryAtmosphereInput): Promise<UnifiedAtmosphereResult>;
}

export interface DeterministicModelComparisonInput {
  datasets: readonly [PublicAtmosphericDataset, PublicAtmosphericDataset];
  latitude: number;
  longitude: number;
  validTime: string;
  run: string;
  variable: string;
  pressureLevelHpa: number;
  gfsGrid?: "0p25" | "0p50";
}

export interface EnsembleModelComparisonInput extends DeterministicModelComparisonInput {
  leftMembers?: readonly string[];
  rightMembers?: readonly string[];
  quantiles: readonly number[];
  thresholdGte?: number;
}

export interface HybridConstituentComparisonInput {
  constituent: HgefsPopulation;
  latitude: number;
  longitude: number;
  validTime: string;
  run: string;
  variable: string;
  pressureLevelHpa: number;
  members?: readonly HgefsMember[];
  quantiles: readonly number[];
  thresholdGte?: number;
}

export class ModelClassComparisonService {
  constructor(
    private readonly queryService: ModelClassComparisonQueryService =
      new UnifiedAtmosphereQueryService(),
  ) {}

  async compareDeterministic(input: DeterministicModelComparisonInput): Promise<unknown> {
    const [left, right] = await alignedQueries(
      this.queryService,
      deterministicQuery(input.datasets[0], input, input.run),
      deterministicQuery(input.datasets[1], input, input.run),
      input.run,
    );
    const leftResult = objectResult(left);
    const rightResult = objectResult(right);
    assertAligned(leftResult, rightResult, input.datasets);

    const definition = VARIABLE_CATALOG[input.variable as keyof typeof VARIABLE_CATALOG];
    if (!definition) throw new Error(`Unknown comparison variable: ${input.variable}`);
    const outputs = definition.outputs.map((output) => {
      const leftValue = requiredProfileValue(
        leftResult,
        input.pressureLevelHpa,
        output.field,
        input.datasets[0],
      );
      const rightValue = requiredProfileValue(
        rightResult,
        input.pressureLevelHpa,
        output.field,
        input.datasets[1],
      );
      const deltaKind = output.field === "windDirectionDeg"
        ? "circular_degrees" as const
        : "linear" as const;
      return {
        field: output.field,
        unit: output.unit,
        leftValue,
        rightValue,
        rightMinusLeft: deltaKind === "circular_degrees"
          ? circularDifference(rightValue, leftValue)
          : rightValue - leftValue,
        deltaKind,
      };
    });

    return {
      run: requiredString(leftResult.run, "comparison run"),
      validTime: requiredString(leftResult.validTime, "comparison validTime"),
      forecastHour: requiredNumber(leftResult.forecastHour, "comparison forecastHour"),
      requestedPoint: { latitude: input.latitude, longitude: input.longitude },
      selection: {
        variable: input.variable,
        pressureLevelHpa: input.pressureLevelHpa,
        outputs: definition.outputs.map((output) => ({
          field: output.field,
          unit: output.unit,
        })),
      },
      left: publicDeterministicSide(input.datasets[0], leftResult, outputs.map((value) => ({
        field: value.field,
        unit: value.unit,
        value: value.leftValue,
      }))),
      right: publicDeterministicSide(input.datasets[1], rightResult, outputs.map((value) => ({
        field: value.field,
        unit: value.unit,
        value: value.rightValue,
      }))),
      comparison: {
        outputs,
        interpretation: "raw_deterministic_model_difference_not_error_or_uncertainty",
      },
    };
  }

  async compareEnsembles(input: EnsembleModelComparisonInput): Promise<unknown> {
    const output = scalarOutput(input.variable);
    const leftMembers = input.leftMembers ?? defaultMembers(input.datasets[0]);
    const rightMembers = input.rightMembers ?? defaultMembers(input.datasets[1]);
    const includeMembers = input.thresholdGte !== undefined;
    const [left, right] = await alignedQueries(
      this.queryService,
      ensembleQuery(input.datasets[0], input, input.run, leftMembers, includeMembers),
      ensembleQuery(input.datasets[1], input, input.run, rightMembers, includeMembers),
      input.run,
    );
    const leftResult = objectResult(left);
    const rightResult = objectResult(right);
    assertAligned(leftResult, rightResult, input.datasets);

    const leftDistribution = requiredDistribution(
      leftResult,
      input.variable,
      input.pressureLevelHpa,
      output.field,
      input.datasets[0],
    );
    const rightDistribution = requiredDistribution(
      rightResult,
      input.variable,
      input.pressureLevelHpa,
      output.field,
      input.datasets[1],
    );
    const quantiles = [...input.quantiles].sort((a, b) => a - b);
    const quantileShifts = quantiles.map((quantile) => {
      const leftValue = requiredQuantile(leftDistribution.quantiles, quantile, input.datasets[0]);
      const rightValue = requiredQuantile(rightDistribution.quantiles, quantile, input.datasets[1]);
      return { quantile, leftValue, rightValue, rightMinusLeft: rightValue - leftValue };
    });
    const threshold = input.thresholdGte === undefined
      ? undefined
      : compareThreshold(
          leftResult,
          rightResult,
          input.datasets,
          input.variable,
          input.pressureLevelHpa,
          output.field,
          input.thresholdGte,
        );

    return {
      run: requiredString(leftResult.run, "comparison run"),
      validTime: requiredString(leftResult.validTime, "comparison validTime"),
      forecastHour: requiredNumber(leftResult.forecastHour, "comparison forecastHour"),
      requestedPoint: { latitude: input.latitude, longitude: input.longitude },
      selection: {
        variable: input.variable,
        pressureLevelHpa: input.pressureLevelHpa,
        outputField: output.field,
        unit: output.unit,
      },
      left: publicEnsembleSide(input.datasets[0], leftResult, leftDistribution),
      right: publicEnsembleSide(input.datasets[1], rightResult, rightDistribution),
      comparison: {
        rightMinusLeftMean: rightDistribution.mean - leftDistribution.mean,
        rightMinusLeftPopulationStdDev:
          rightDistribution.populationStdDev - leftDistribution.populationStdDev,
        populationStdDevRatioRightToLeft: leftDistribution.populationStdDev === 0
          ? null
          : rightDistribution.populationStdDev / leftDistribution.populationStdDev,
        quantileShifts,
        ...(threshold === undefined ? {} : { threshold }),
        interpretation:
          "independent_raw_ensemble_distributions_no_member_pairing_not_calibrated_uncertainty",
      },
    };
  }

  async compareHybridConstituent(
    input: HybridConstituentComparisonInput,
  ): Promise<unknown> {
    const output = scalarOutput(input.variable);
    const members = [...(input.members ?? HGEFS_MEMBERS)] as HgefsMember[];
    const response = await this.queryService.query({
      dataset: "hgefs",
      geometry: { type: "point", latitude: input.latitude, longitude: input.longitude },
      time: { at: input.validTime },
      selection: {
        variables: [input.variable],
        pressureLevelsHpa: [input.pressureLevelHpa],
      },
      forecast: { run: input.run },
      ensemble: {
        members,
        quantiles: [...input.quantiles],
        includeMembers: true,
      },
    });
    const result = objectResult(response);
    const rawMembers = requiredArray(result.members, "HGEFS comparison member payloads");
    const hybridValues = rawMembers.map((member) =>
      memberProfileValue(member, input.pressureLevelHpa, output.field, "hgefs"));
    const constituentValues = rawMembers
      .filter((member) => object(member).population === input.constituent)
      .map((member) =>
        memberProfileValue(member, input.pressureLevelHpa, output.field, input.constituent));
    if (constituentValues.length < 2) {
      throw new Error(
        `HGEFS/${input.constituent.toUpperCase()} comparison requires at least two constituent members`,
      );
    }

    const quantiles = [...input.quantiles].sort((a, b) => a - b);
    const hybrid = summarizeNumericDistribution(hybridValues, quantiles);
    const constituent = summarizeNumericDistribution(constituentValues, quantiles);
    const quantileShifts = quantiles.map((quantile) => ({
      quantile,
      hybridValue: requiredQuantile(hybrid.quantiles, quantile, "hgefs"),
      constituentValue: requiredQuantile(
        constituent.quantiles,
        quantile,
        input.constituent,
      ),
      constituentMinusHybrid:
        requiredQuantile(constituent.quantiles, quantile, input.constituent)
        - requiredQuantile(hybrid.quantiles, quantile, "hgefs"),
    }));
    const threshold = input.thresholdGte === undefined
      ? undefined
      : thresholdFromValues(
          hybridValues,
          constituentValues,
          input.thresholdGte,
          "hybrid",
          input.constituent,
        );

    return {
      run: requiredString(result.run, "HGEFS comparison run"),
      validTime: requiredString(result.validTime, "HGEFS comparison validTime"),
      forecastHour: requiredNumber(result.forecastHour, "HGEFS comparison forecastHour"),
      requestedPoint: { latitude: input.latitude, longitude: input.longitude },
      selection: {
        variable: input.variable,
        pressureLevelHpa: input.pressureLevelHpa,
        outputField: output.field,
        unit: output.unit,
        constituent: input.constituent,
      },
      hgefs: {
        model: result.model,
        constituentGridPoints: result.constituentGridPoints,
        summary: hybrid,
        source: result.source,
      },
      constituent: {
        dataset: input.constituent,
        memberCount: constituentValues.length,
        summary: constituent,
        source: constituentSource(result, input.constituent),
      },
      comparison: {
        constituentMinusHybridMean: constituent.mean - hybrid.mean,
        constituentMinusHybridPopulationStdDev:
          constituent.populationStdDev - hybrid.populationStdDev,
        populationStdDevRatioConstituentToHybrid: hybrid.populationStdDev === 0
          ? null
          : constituent.populationStdDev / hybrid.populationStdDev,
        quantileShifts,
        ...(threshold === undefined ? {} : { threshold }),
        interpretation:
          "overlapping_hybrid_and_constituent_raw_distributions_not_independent_not_calibrated_uncertainty",
      },
    };
  }
}

function deterministicQuery(
  dataset: PublicAtmosphericDataset,
  input: DeterministicModelComparisonInput,
  run: string,
): QueryAtmosphereInput {
  return {
    dataset,
    geometry: { type: "point", latitude: input.latitude, longitude: input.longitude },
    time: { at: input.validTime },
    selection: {
      variables: [input.variable],
      pressureLevelsHpa: [input.pressureLevelHpa],
    },
    forecast: {
      run,
      ...(dataset === "gfs" && input.gfsGrid !== undefined ? { grid: input.gfsGrid } : {}),
    },
  };
}

function ensembleQuery(
  dataset: PublicAtmosphericDataset,
  input: EnsembleModelComparisonInput,
  run: string,
  members: readonly string[],
  includeMembers: boolean,
): QueryAtmosphereInput {
  return {
    dataset,
    geometry: { type: "point", latitude: input.latitude, longitude: input.longitude },
    time: { at: input.validTime },
    selection: {
      variables: [input.variable],
      pressureLevelsHpa: [input.pressureLevelHpa],
    },
    forecast: { run },
    ensemble: {
      members: [...members],
      quantiles: [...input.quantiles],
      ...(includeMembers ? { includeMembers: true } : {}),
    },
  };
}

async function alignedQueries(
  service: ModelClassComparisonQueryService,
  leftInput: QueryAtmosphereInput,
  rightInput: QueryAtmosphereInput,
  requestedRun: string,
): Promise<[UnifiedAtmosphereResult, UnifiedAtmosphereResult]> {
  const [left, right] = await Promise.all([
    service.query(leftInput),
    service.query(rightInput),
  ]);
  if (requestedRun !== "latest" && requestedRun !== "latest_complete") return [left, right];

  const leftRun = requiredString(objectResult(left).run, "left latest run");
  const rightRun = requiredString(objectResult(right).run, "right latest run");
  if (leftRun === rightRun) return [left, right];

  const sharedRun = new Date(Math.min(Date.parse(leftRun), Date.parse(rightRun))).toISOString();
  const [alignedLeft, alignedRight] = await Promise.all([
    leftRun === sharedRun
      ? Promise.resolve(left)
      : service.query(withExplicitRun(leftInput, sharedRun)),
    rightRun === sharedRun
      ? Promise.resolve(right)
      : service.query(withExplicitRun(rightInput, sharedRun)),
  ]);
  return [alignedLeft, alignedRight];
}

function withExplicitRun(input: QueryAtmosphereInput, run: string): QueryAtmosphereInput {
  return {
    ...input,
    forecast: { ...(input.forecast ?? {}), run },
  };
}

function assertAligned(
  left: Record<string, any>,
  right: Record<string, any>,
  datasets: readonly [PublicAtmosphericDataset, PublicAtmosphericDataset],
): void {
  if (left.run !== right.run) {
    throw new Error(
      `${datasets[0]}/${datasets[1]} comparison received inconsistent initialization cycles`,
    );
  }
  if (left.validTime !== right.validTime || left.forecastHour !== right.forecastHour) {
    throw new Error(
      `${datasets[0]}/${datasets[1]} comparison received inconsistent valid-time semantics`,
    );
  }
}

function publicDeterministicSide(
  dataset: PublicAtmosphericDataset,
  result: Record<string, any>,
  values: readonly { field: string; unit: string; value: number }[],
) {
  return {
    dataset,
    model: result.model,
    gridPoint: result.gridPoint,
    values,
    source: result.source,
  };
}

function publicEnsembleSide(
  dataset: PublicAtmosphericDataset,
  result: Record<string, any>,
  summary: NumericDistribution,
) {
  return {
    dataset,
    model: result.model,
    ...(result.gridPoint === undefined ? {} : { gridPoint: result.gridPoint }),
    ...(result.constituentGridPoints === undefined
      ? {}
      : { constituentGridPoints: result.constituentGridPoints }),
    memberCount: summary.memberCount,
    summary,
    source: result.source,
  };
}

function objectResult(response: UnifiedAtmosphereResult): Record<string, any> {
  return object(response.result);
}

function object(value: unknown): Record<string, any> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Comparison query returned a non-object result");
  }
  return value as Record<string, any>;
}

function requiredProfileValue(
  result: Record<string, any>,
  pressureLevelHpa: number,
  field: string,
  dataset: string,
): number {
  const levels = requiredArray(result.levels, `${dataset} profile levels`);
  const level = levels.map(object).find((candidate) => candidate.pressureHpa === pressureLevelHpa);
  if (!level) throw new Error(`${dataset} comparison is missing ${pressureLevelHpa} hPa`);
  return requiredNumber(level[field], `${dataset} ${field}@${pressureLevelHpa}hPa`);
}

function scalarOutput(variable: string): { field: string; unit: string } {
  const definition = VARIABLE_CATALOG[variable as keyof typeof VARIABLE_CATALOG];
  if (!definition) throw new Error(`Unknown comparison variable: ${variable}`);
  if (definition.outputs.length !== 1) {
    throw new Error(
      `Cross-ensemble comparison requires one scalar output for ${variable}; choose u_wind or v_wind rather than vector wind`,
    );
  }
  return definition.outputs[0]!;
}

interface NumericDistribution {
  memberCount: number;
  mean: number;
  populationStdDev: number;
  min: number;
  max: number;
  quantiles: readonly { quantile: number; value: number }[];
}

function requiredDistribution(
  result: Record<string, any>,
  variable: string,
  pressureLevelHpa: number,
  outputField: string,
  dataset: string,
): NumericDistribution {
  const summaries = requiredArray(result.pressureSummaries, `${dataset} pressure summaries`);
  for (const raw of summaries) {
    const summary = object(raw);
    if (summary.pressureLevelHpa !== pressureLevelHpa) continue;
    if (
      summary.variable === variable
      && summary.distribution !== undefined
      && (summary.outputField === undefined || summary.outputField === outputField)
    ) {
      return numericDistribution(summary.distribution, dataset);
    }
    if (
      summary.field === outputField
      && summary.aggregation === "numeric_distribution"
      && summary.distribution !== undefined
    ) {
      return numericDistribution(summary.distribution, dataset);
    }
    if (summary.variable === variable && Array.isArray(summary.outputs)) {
      const output = summary.outputs.map(object).find((candidate) =>
        candidate.field === outputField && candidate.aggregation === "numeric_distribution");
      if (output?.distribution !== undefined) {
        return numericDistribution(output.distribution, dataset);
      }
    }
  }
  throw new Error(
    `${dataset} comparison is missing numeric distribution ${outputField}@${pressureLevelHpa}hPa`,
  );
}

function numericDistribution(value: unknown, dataset: string): NumericDistribution {
  const distribution = object(value);
  return {
    memberCount: requiredNumber(distribution.memberCount, `${dataset} memberCount`),
    mean: requiredNumber(distribution.mean, `${dataset} mean`),
    populationStdDev: requiredNumber(
      distribution.populationStdDev,
      `${dataset} populationStdDev`,
    ),
    min: requiredNumber(distribution.min, `${dataset} min`),
    max: requiredNumber(distribution.max, `${dataset} max`),
    quantiles: requiredArray(distribution.quantiles, `${dataset} quantiles`).map((entry) => {
      const item = object(entry);
      return {
        quantile: requiredNumber(item.quantile, `${dataset} quantile`),
        value: requiredNumber(item.value, `${dataset} quantile value`),
      };
    }),
  };
}

function compareThreshold(
  left: Record<string, any>,
  right: Record<string, any>,
  datasets: readonly [PublicAtmosphericDataset, PublicAtmosphericDataset],
  variable: string,
  pressureLevelHpa: number,
  outputField: string,
  threshold: number,
) {
  const leftValues = memberValues(left, variable, pressureLevelHpa, outputField, datasets[0]);
  const rightValues = memberValues(right, variable, pressureLevelHpa, outputField, datasets[1]);
  return thresholdFromValues(leftValues, rightValues, threshold, datasets[0], datasets[1]);
}

function memberValues(
  result: Record<string, any>,
  variable: string,
  pressureLevelHpa: number,
  outputField: string,
  dataset: string,
): number[] {
  return requiredArray(result.members, `${dataset} member payloads`).map((member) => {
    const candidate = object(member);
    if (Array.isArray(candidate.levels)) {
      return memberProfileValue(candidate, pressureLevelHpa, outputField, dataset);
    }
    const pressure = requiredArray(
      candidate.pressureValues,
      `${dataset} member pressure values`,
    ).map(object).find((value) =>
      value.variable === variable && value.pressureLevelHpa === pressureLevelHpa);
    if (!pressure) {
      throw new Error(`${dataset} member is missing ${variable}@${pressureLevelHpa}hPa`);
    }
    if (typeof pressure.value === "number") return pressure.value;
    return requiredNumber(
      object(pressure.values)[outputField],
      `${dataset} member ${outputField}`,
    );
  });
}

function memberProfileValue(
  rawMember: unknown,
  pressureLevelHpa: number,
  outputField: string,
  dataset: string,
): number {
  const member = object(rawMember);
  const level = requiredArray(member.levels, `${dataset} member levels`)
    .map(object)
    .find((candidate) => candidate.pressureHpa === pressureLevelHpa);
  if (!level) {
    throw new Error(`${dataset} member is missing ${pressureLevelHpa} hPa`);
  }
  return requiredNumber(
    level[outputField],
    `${dataset} member ${outputField}@${pressureLevelHpa}hPa`,
  );
}

function thresholdFromValues(
  leftValues: readonly number[],
  rightValues: readonly number[],
  threshold: number,
  leftLabel: string,
  rightLabel: string,
) {
  const leftCount = leftValues.filter((value) => value >= threshold).length;
  const rightCount = rightValues.filter((value) => value >= threshold).length;
  const leftFraction = leftCount / leftValues.length;
  const rightFraction = rightCount / rightValues.length;
  return {
    operator: "gte" as const,
    value: threshold,
    leftLabel,
    rightLabel,
    leftCount,
    leftFraction,
    rightCount,
    rightFraction,
    rightMinusLeftFraction: rightFraction - leftFraction,
    interpretation: "raw_member_fractions_not_calibrated_probabilities" as const,
  };
}

function requiredQuantile(
  quantiles: readonly { quantile: number; value: number }[],
  requested: number,
  dataset: string,
): number {
  const match = quantiles.find((candidate) => candidate.quantile === requested);
  if (!match) throw new Error(`${dataset} comparison summary is missing quantile ${requested}`);
  return match.value;
}

function defaultMembers(dataset: PublicAtmosphericDataset): readonly string[] {
  switch (dataset) {
    case "gefs":
      return GEFS_MEMBERS;
    case "aigefs":
      return AIGEFS_MEMBERS;
    case "ifs-ens":
      return IFS_ENS_MEMBERS;
    case "aifs-ens":
      return AIFS_ENS_MEMBERS;
    default:
      throw new Error(`Dataset ${dataset} does not have an ensemble comparison population`);
  }
}

function constituentSource(result: Record<string, any>, population: HgefsPopulation): unknown {
  const source = object(result.source);
  const constituents = Array.isArray(source.constituents) ? source.constituents.map(object) : [];
  return constituents.find((candidate) => candidate.population === population)?.source;
}

function requiredArray(value: unknown, context: string): any[] {
  if (!Array.isArray(value)) throw new Error(`Comparison is missing ${context}`);
  return value;
}

function requiredString(value: unknown, context: string): string {
  if (typeof value !== "string") throw new Error(`Comparison is missing ${context}`);
  return value;
}

function requiredNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Comparison is missing numeric ${context}`);
  }
  return value;
}

function circularDifference(right: number, left: number): number {
  return ((right - left + 540) % 360) - 180;
}
