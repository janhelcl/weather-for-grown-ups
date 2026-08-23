export interface HeightSample {
  geopotentialHeightGpm: number;
}

export type ThresholdCrossingDirection = "increasing" | "decreasing" | "indeterminate";

export type ThresholdCrossing<T extends HeightSample> =
  | {
      method: "interpolated";
      lowerSample: T;
      upperSample: T;
      fraction: number;
      direction: ThresholdCrossingDirection;
    }
  | {
      method: "exact_sample";
      sample: T;
      lowerSample: T;
      upperSample: T;
      direction: ThresholdCrossingDirection;
    };

export interface AdjacentGradient<T extends HeightSample> {
  lowerSample: T;
  upperSample: T;
  depthGpm: number;
  lowerValue: number;
  upperValue: number;
  deltaValue: number;
  gradientPerKm: number;
}

export interface ContiguousProfileLayer<T extends HeightSample> {
  baseSample: T;
  topSample: T;
  startIndex: number;
  endIndex: number;
  sampledSegments: number;
}

export interface ProfileExtremum<T extends HeightSample> {
  sample: T;
  value: number;
}

export interface ProfileExtrema<T extends HeightSample> {
  min: ProfileExtremum<T>;
  max: ProfileExtremum<T>;
}

export function orderSamplesByHeight<T extends HeightSample>(samples: readonly T[]): T[] {
  const ordered = [...samples].sort((a, b) => a.geopotentialHeightGpm - b.geopotentialHeightGpm);
  for (let index = 1; index < ordered.length; index += 1) {
    const lower = ordered[index - 1]!;
    const upper = ordered[index]!;
    if (!(upper.geopotentialHeightGpm > lower.geopotentialHeightGpm)) {
      throw new Error(
        `Expected strictly increasing geopotential heights, received ${lower.geopotentialHeightGpm} and ${upper.geopotentialHeightGpm} gpm`,
      );
    }
  }
  return ordered;
}

export function deriveAdjacentGradients<T extends HeightSample>(
  samples: readonly T[],
  valueOf: (sample: T) => number,
): AdjacentGradient<T>[] {
  const ordered = orderSamplesByHeight(samples);
  const gradients: AdjacentGradient<T>[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const lowerSample = ordered[index - 1]!;
    const upperSample = ordered[index]!;
    const depthGpm = upperSample.geopotentialHeightGpm - lowerSample.geopotentialHeightGpm;
    const lowerValue = valueOf(lowerSample);
    const upperValue = valueOf(upperSample);
    const deltaValue = upperValue - lowerValue;
    gradients.push({
      lowerSample,
      upperSample,
      depthGpm,
      lowerValue,
      upperValue,
      deltaValue,
      gradientPerKm: deltaValue / depthGpm * 1000,
    });
  }
  return gradients;
}

export function findThresholdCrossings<T extends HeightSample>(
  samples: readonly T[],
  valueOf: (sample: T) => number,
  threshold: number,
): ThresholdCrossing<T>[] {
  const ordered = orderSamplesByHeight(samples);
  const crossings: ThresholdCrossing<T>[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const sample = ordered[index]!;
    if (valueOf(sample) !== threshold) continue;
    const lowerSample = ordered[Math.max(0, index - 1)]!;
    const upperSample = ordered[Math.min(ordered.length - 1, index + 1)]!;
    crossings.push({
      method: "exact_sample",
      sample,
      lowerSample,
      upperSample,
      direction: directionAcross(valueOf(lowerSample), valueOf(upperSample), threshold),
    });
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const lowerSample = ordered[index - 1]!;
    const upperSample = ordered[index]!;
    const lowerValue = valueOf(lowerSample);
    const upperValue = valueOf(upperSample);
    if (lowerValue === threshold || upperValue === threshold) continue;
    if ((lowerValue - threshold) * (upperValue - threshold) >= 0) continue;

    crossings.push({
      method: "interpolated",
      lowerSample,
      upperSample,
      fraction: (threshold - lowerValue) / (upperValue - lowerValue),
      direction: upperValue > lowerValue ? "increasing" : "decreasing",
    });
  }

  return crossings.sort((a, b) => crossingHeight(a) - crossingHeight(b));
}

export function findContiguousLayers<T extends HeightSample>(
  samples: readonly T[],
  segmentMatches: (gradient: AdjacentGradient<T>) => boolean,
  valueOf: (sample: T) => number,
): ContiguousProfileLayer<T>[] {
  const ordered = orderSamplesByHeight(samples);
  const gradients = deriveAdjacentGradients(ordered, valueOf);
  const layers: ContiguousProfileLayer<T>[] = [];
  let startIndex: number | undefined;

  for (let segmentIndex = 0; segmentIndex < gradients.length; segmentIndex += 1) {
    const matches = segmentMatches(gradients[segmentIndex]!);
    if (matches && startIndex === undefined) startIndex = segmentIndex;
    const isLastSegment = segmentIndex === gradients.length - 1;

    if (startIndex !== undefined && (!matches || isLastSegment)) {
      const endSegmentIndex = matches && isLastSegment ? segmentIndex : segmentIndex - 1;
      layers.push({
        baseSample: ordered[startIndex]!,
        topSample: ordered[endSegmentIndex + 1]!,
        startIndex,
        endIndex: endSegmentIndex + 1,
        sampledSegments: endSegmentIndex - startIndex + 1,
      });
      startIndex = undefined;
    }
  }

  return layers;
}

export function findProfileExtrema<T extends HeightSample>(
  samples: readonly T[],
  valueOf: (sample: T) => number,
): ProfileExtrema<T> {
  const ordered = orderSamplesByHeight(samples);
  const first = ordered[0];
  if (!first) throw new Error("Profile extrema require at least one sample");

  let min = { sample: first, value: valueOf(first) };
  let max = { sample: first, value: valueOf(first) };
  for (const sample of ordered.slice(1)) {
    const value = valueOf(sample);
    if (value < min.value) min = { sample, value };
    if (value > max.value) max = { sample, value };
  }
  return { min, max };
}

function directionAcross(lowerValue: number, upperValue: number, threshold: number): ThresholdCrossingDirection {
  if (lowerValue < threshold && upperValue > threshold) return "increasing";
  if (lowerValue > threshold && upperValue < threshold) return "decreasing";
  return "indeterminate";
}

function crossingHeight<T extends HeightSample>(crossing: ThresholdCrossing<T>): number {
  if (crossing.method === "exact_sample") return crossing.sample.geopotentialHeightGpm;
  return crossing.lowerSample.geopotentialHeightGpm
    + crossing.fraction * (crossing.upperSample.geopotentialHeightGpm - crossing.lowerSample.geopotentialHeightGpm);
}
