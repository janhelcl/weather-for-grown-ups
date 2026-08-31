import type { HgefsPopulation } from "../catalog/hgefs.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import type {
  PublicAtmosphericDataset,
  UnifiedAtmosphereResult,
} from "../schema/unified-api.js";

type ComparisonResultObject = Record<string, unknown>;

export function assertAligned(
  left: ComparisonResultObject,
  right: ComparisonResultObject,
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

export function publicDeterministicSide(
  dataset: PublicAtmosphericDataset,
  result: ComparisonResultObject,
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

export function publicEnsembleSide(
  dataset: PublicAtmosphericDataset,
  result: ComparisonResultObject,
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

export function objectResult(response: UnifiedAtmosphereResult): ComparisonResultObject {
  return object(response.result);
}

function object(value: unknown): ComparisonResultObject {
  if (typeof value !== "object" || value === null) {
    throw new Error("Comparison query returned a non-object result");
  }
  return value as ComparisonResultObject;
}

export function requiredProfileValue(
  result: ComparisonResultObject,
  pressureLevelHpa: number,
  field: string,
  dataset: string,
): number {
  const levels = requiredArray(result.levels, `${dataset} profile levels`);
  const level = levels.map(object).find((candidate) => candidate.pressureHpa === pressureLevelHpa);
  if (!level) throw new Error(`${dataset} comparison is missing ${pressureLevelHpa} hPa`);
  return requiredNumber(level[field], `${dataset} ${field}@${pressureLevelHpa}hPa`);
}

export function scalarOutput(variable: string): { field: string; unit: string } {
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

export function requiredDistribution(
  result: ComparisonResultObject,
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

export function compareThreshold(
  left: ComparisonResultObject,
  right: ComparisonResultObject,
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
  result: ComparisonResultObject,
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

export function memberProfileValue(
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

export function thresholdFromValues(
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

export function requiredQuantile(
  quantiles: readonly { quantile: number; value: number }[],
  requested: number,
  dataset: string,
): number {
  const match = quantiles.find((candidate) => candidate.quantile === requested);
  if (!match) throw new Error(`${dataset} comparison summary is missing quantile ${requested}`);
  return match.value;
}

export function constituentSource(result: ComparisonResultObject, population: HgefsPopulation): unknown {
  const source = object(result.source);
  const constituents = Array.isArray(source.constituents) ? source.constituents.map(object) : [];
  return constituents.find((candidate) => candidate.population === population)?.source;
}

export function requiredArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Comparison is missing ${context}`);
  return value;
}

export function requiredString(value: unknown, context: string): string {
  if (typeof value !== "string") throw new Error(`Comparison is missing ${context}`);
  return value;
}

export function requiredNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Comparison is missing numeric ${context}`);
  }
  return value;
}

export function circularDifference(right: number, left: number): number {
  return ((right - left + 540) % 360) - 180;
}
