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

export interface WindVectorSample {
  uWindMs: number;
  vWindMs: number;
  speedMs: number;
  directionDeg: number;
}

export interface WindVectorSummary {
  memberCount: number;
  vectorMean: {
    uWindMs: number;
    vWindMs: number;
    speedMs: number;
    directionDeg: number | null;
  };
  speedDistribution: NumericDistributionSummary;
  directionalConcentration: {
    memberCount: number;
    meanDirectionDeg: number | null;
    resultantLength: number | null;
  };
  calm: {
    operator: "lt";
    thresholdSpeedMs: number;
    count: number;
    fraction: number;
  };
}

export const DEFAULT_ENSEMBLE_CALM_THRESHOLD_MS = 0.5;
const DIRECTION_EPSILON = 1e-12;

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
  const radians = values.map((value) => normalizeDirectionDeg(value) * Math.PI / 180);
  const meanSin = radians.reduce((sum, value) => sum + Math.sin(value), 0) / radians.length;
  const meanCos = radians.reduce((sum, value) => sum + Math.cos(value), 0) / radians.length;
  const meanDirectionDeg = (Math.atan2(meanSin, meanCos) * 180 / Math.PI + 360) % 360;
  return {
    memberCount: values.length,
    meanDirectionDeg,
    resultantLength: Math.hypot(meanSin, meanCos),
  };
}

export function windVectorSampleFromComponents(
  uWindMs: number,
  vWindMs: number,
): WindVectorSample {
  assertFiniteWindValue(uWindMs, "uWindMs");
  assertFiniteWindValue(vWindMs, "vWindMs");
  const speedMs = Math.hypot(uWindMs, vWindMs);
  return {
    uWindMs,
    vWindMs,
    speedMs,
    directionDeg: meteorologicalDirectionDeg(uWindMs, vWindMs),
  };
}

export function windVectorSampleFromSpeedDirection(
  speedMs: number,
  directionDeg: number,
): WindVectorSample {
  assertFiniteWindValue(speedMs, "speedMs");
  assertFiniteWindValue(directionDeg, "directionDeg");
  if (speedMs < 0) throw new Error(`Wind speed must be nonnegative; received ${speedMs}`);
  const normalizedDirectionDeg = normalizeDirectionDeg(directionDeg);
  const radians = normalizedDirectionDeg * Math.PI / 180;
  return {
    uWindMs: -speedMs * Math.sin(radians),
    vWindMs: -speedMs * Math.cos(radians),
    speedMs,
    directionDeg: normalizedDirectionDeg,
  };
}

export function summarizeWindVectorDistribution(
  samples: readonly WindVectorSample[],
  quantiles: readonly number[],
  calmThresholdMs = DEFAULT_ENSEMBLE_CALM_THRESHOLD_MS,
): WindVectorSummary {
  if (samples.length === 0) throw new Error("Cannot summarize an empty ensemble wind-vector distribution");
  assertFiniteWindValue(calmThresholdMs, "calmThresholdMs");
  if (calmThresholdMs < 0) {
    throw new Error(`Calm threshold must be nonnegative; received ${calmThresholdMs}`);
  }
  for (const sample of samples) validateWindVectorSample(sample);

  const meanU = mean(samples.map((sample) => sample.uWindMs));
  const meanV = mean(samples.map((sample) => sample.vWindMs));
  const vectorMeanSpeed = Math.hypot(meanU, meanV);
  const nonCalm = samples.filter((sample) => sample.speedMs >= calmThresholdMs);
  const circular = nonCalm.length === 0
    ? null
    : summarizeCircularDegrees(nonCalm.map((sample) => sample.directionDeg));
  const calmCount = samples.length - nonCalm.length;
  const resultantLength = circular?.resultantLength ?? null;

  return {
    memberCount: samples.length,
    vectorMean: {
      uWindMs: meanU,
      vWindMs: meanV,
      speedMs: vectorMeanSpeed,
      directionDeg: vectorMeanSpeed <= DIRECTION_EPSILON
        ? null
        : meteorologicalDirectionDeg(meanU, meanV),
    },
    speedDistribution: summarizeNumericDistribution(
      samples.map((sample) => sample.speedMs),
      quantiles,
    ),
    directionalConcentration: {
      memberCount: nonCalm.length,
      meanDirectionDeg: circular === null || circular.resultantLength <= DIRECTION_EPSILON
        ? null
        : circular.meanDirectionDeg,
      resultantLength,
    },
    calm: {
      operator: "lt",
      thresholdSpeedMs: calmThresholdMs,
      count: calmCount,
      fraction: calmCount / samples.length,
    },
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

function meteorologicalDirectionDeg(uWindMs: number, vWindMs: number): number {
  return normalizeDirectionDeg(Math.atan2(-uWindMs, -vWindMs) * 180 / Math.PI);
}

function normalizeDirectionDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

function validateWindVectorSample(sample: WindVectorSample): void {
  assertFiniteWindValue(sample.uWindMs, "uWindMs");
  assertFiniteWindValue(sample.vWindMs, "vWindMs");
  assertFiniteWindValue(sample.speedMs, "speedMs");
  assertFiniteWindValue(sample.directionDeg, "directionDeg");
  if (sample.speedMs < 0) throw new Error(`Wind speed must be nonnegative; received ${sample.speedMs}`);
}

function assertFiniteWindValue(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new Error(`Wind ${field} must be finite; received ${value}`);
}
