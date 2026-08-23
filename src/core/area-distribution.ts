import type { GridValuePoint } from "../grib/wgrib2-grid.js";
import { AREA_PERCENTILE_METHOD, type AreaThreshold } from "../schema/area-summary.js";

export interface AreaPercentileResult {
  percentile: number;
  value: number;
}

export interface AreaThresholdResult {
  operator: AreaThreshold["operator"];
  threshold: number;
  matchingGridPoints: number;
  fraction: number;
}

export interface AreaExtremumResult {
  value: number;
  gridPoint: { latitude: number; longitude: number };
  tiedGridPoints: number;
}

export interface AreaDistributionResult {
  percentileMethod?: typeof AREA_PERCENTILE_METHOD;
  percentiles?: AreaPercentileResult[];
  thresholdFractions?: AreaThresholdResult[];
  extrema?: {
    min: AreaExtremumResult;
    max: AreaExtremumResult;
  };
}

export interface AreaDistributionComputation {
  statistics: {
    definedGridPoints: number;
    mean: number;
    min: number;
    max: number;
  };
  distribution: AreaDistributionResult;
}

export function computeAreaDistribution(
  points: readonly GridValuePoint[],
  options: {
    percentiles?: readonly number[] | undefined;
    thresholds?: readonly AreaThreshold[] | undefined;
    includeExtremaLocations: boolean;
  },
): AreaDistributionComputation {
  if (points.length === 0) throw new Error("Area distribution requires at least one defined grid point");

  let sum = 0;
  let min = points[0]!.value;
  let max = points[0]!.value;
  let minPoint = points[0]!;
  let maxPoint = points[0]!;
  let minTies = 0;
  let maxTies = 0;

  for (const point of points) {
    sum += point.value;
    if (point.value < min) {
      min = point.value;
      minPoint = point;
      minTies = 1;
    } else if (point.value === min) {
      minTies += 1;
    }
    if (point.value > max) {
      max = point.value;
      maxPoint = point;
      maxTies = 1;
    } else if (point.value === max) {
      maxTies += 1;
    }
  }

  const requestedPercentiles = options.percentiles ?? [];
  const requestedThresholds = options.thresholds ?? [];
  const distribution: AreaDistributionResult = {};

  if (requestedPercentiles.length > 0) {
    const sorted = points.map((point) => point.value).sort((a, b) => a - b);
    distribution.percentileMethod = AREA_PERCENTILE_METHOD;
    distribution.percentiles = requestedPercentiles.map((percentile) => ({
      percentile,
      value: linearPercentile(sorted, percentile),
    }));
  }

  if (requestedThresholds.length > 0) {
    distribution.thresholdFractions = requestedThresholds.map((threshold) => {
      const matchingGridPoints = points.reduce(
        (count, point) => count + (matchesThreshold(point.value, threshold) ? 1 : 0),
        0,
      );
      return {
        operator: threshold.operator,
        threshold: threshold.value,
        matchingGridPoints,
        fraction: matchingGridPoints / points.length,
      };
    });
  }

  if (options.includeExtremaLocations) {
    distribution.extrema = {
      min: {
        value: min,
        gridPoint: { latitude: minPoint.latitude, longitude: minPoint.longitude },
        tiedGridPoints: minTies,
      },
      max: {
        value: max,
        gridPoint: { latitude: maxPoint.latitude, longitude: maxPoint.longitude },
        tiedGridPoints: maxTies,
      },
    };
  }

  return {
    statistics: {
      definedGridPoints: points.length,
      mean: sum / points.length,
      min,
      max,
    },
    distribution,
  };
}

export function linearPercentile(sortedValues: readonly number[], percentile: number): number {
  if (sortedValues.length === 0) throw new Error("Percentile requires at least one value");
  if (percentile < 0 || percentile > 100) throw new Error("Percentile must be between 0 and 100");
  if (sortedValues.length === 1) return sortedValues[0]!;
  const position = (percentile / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex]!;
  const upper = sortedValues[upperIndex]!;
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function matchesThreshold(value: number, threshold: AreaThreshold): boolean {
  return threshold.operator === "gte" ? value >= threshold.value : value <= threshold.value;
}
