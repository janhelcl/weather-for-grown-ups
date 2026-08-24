export interface QuantileValue {
  quantile: number;
  value: number;
}

export interface NumericDistributionSummary {
  memberCount: number;
  mean: number;
  populationStdDev: number;
  min: number;
  max: number;
  quantiles: QuantileValue[];
}

export interface CircularDirectionSummary {
  memberCount: number;
  meanDirectionDeg: number;
  resultantLength: number;
}

export interface ThresholdGteSummary {
  operator: "gte";
  value: number;
  count: number;
  fraction: number;
  interpretation: "raw_member_fraction_not_calibrated_probability";
}

export function summarizeNumericDistribution(
  values: readonly number[],
  quantiles: readonly number[],
): NumericDistributionSummary {
  if (values.length === 0) throw new Error("Cannot summarize an empty ensemble distribution");
  return {
    memberCount: values.length,
    mean: mean(values),
    populationStdDev: populationStdDev(values),
    min: Math.min(...values),
    max: Math.max(...values),
    quantiles: [...quantiles].sort((a, b) => a - b).map((q) => ({
      quantile: q,
      value: quantile(values, q),
    })),
  };
}

export function summarizeCircularDegrees(values: readonly number[]): CircularDirectionSummary {
  if (values.length === 0) throw new Error("Cannot summarize an empty circular ensemble distribution");
  const radians = values.map((value) => ((value % 360 + 360) % 360) * Math.PI / 180);
  const meanSin = radians.reduce((sum, value) => sum + Math.sin(value), 0) / radians.length;
  const meanCos = radians.reduce((sum, value) => sum + Math.cos(value), 0) / radians.length;
  const meanDirectionDeg = (Math.atan2(meanSin, meanCos) * 180 / Math.PI + 360) % 360;
  return {
    memberCount: values.length,
    meanDirectionDeg,
    resultantLength: Math.hypot(meanSin, meanCos),
  };
}

export function thresholdGteSummary(values: readonly number[], threshold: number): ThresholdGteSummary {
  if (values.length === 0) throw new Error("Cannot summarize an empty ensemble threshold distribution");
  const count = values.filter((value) => value >= threshold).length;
  return {
    operator: "gte",
    value: threshold,
    count,
    fraction: count / values.length,
    interpretation: "raw_member_fraction_not_calibrated_probability",
  };
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("Cannot compute an ensemble mean from no values");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function populationStdDev(values: readonly number[]): number {
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error("Cannot compute an ensemble quantile from no values");
  if (q < 0 || q > 1) throw new Error(`Quantile must be between 0 and 1, received ${q}`);
  const sorted = [...values].sort((a, b) => a - b);
  const position = q * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) throw new Error("Cannot compute an ensemble quantile from no values");
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}
