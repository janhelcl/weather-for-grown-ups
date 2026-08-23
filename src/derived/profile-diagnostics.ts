import {
  findContiguousLayers,
  findThresholdCrossings,
  orderSamplesByHeight,
} from "./profile-features.js";

export interface SampledThermodynamicLevel {
  pressureHpa: number;
  geopotentialHeightGpm: number;
  temperatureC: number;
}

export type FreezingCrossingTransition = "warm_to_cold" | "cold_to_warm" | "indeterminate";
export type FreezingCrossingMethod = "interpolated" | "exact_sample";

export interface FreezingLevelCrossing {
  pressureHpa: number;
  geopotentialHeightGpm: number;
  method: FreezingCrossingMethod;
  transition: FreezingCrossingTransition;
  lowerLevel: SampledThermodynamicLevel;
  upperLevel: SampledThermodynamicLevel;
}

export interface TemperatureInversionLayer {
  basePressureHpa: number;
  topPressureHpa: number;
  baseGeopotentialHeightGpm: number;
  topGeopotentialHeightGpm: number;
  baseTemperatureC: number;
  topTemperatureC: number;
  depthGpm: number;
  temperatureIncreaseC: number;
  meanTemperatureGradientCPerKm: number;
  sampledSegments: number;
}

export function orderProfileByHeight(levels: readonly SampledThermodynamicLevel[]): SampledThermodynamicLevel[] {
  return orderSamplesByHeight(levels);
}

export function deriveFreezingLevelCrossings(
  levels: readonly SampledThermodynamicLevel[],
): FreezingLevelCrossing[] {
  return findThresholdCrossings(levels, (level) => level.temperatureC, 0).map((crossing) => {
    if (crossing.method === "exact_sample") {
      return {
        pressureHpa: crossing.sample.pressureHpa,
        geopotentialHeightGpm: crossing.sample.geopotentialHeightGpm,
        method: "exact_sample" as const,
        transition: crossingTransition(crossing.direction),
        lowerLevel: crossing.lowerSample,
        upperLevel: crossing.upperSample,
      };
    }

    const geopotentialHeightGpm = crossing.lowerSample.geopotentialHeightGpm
      + crossing.fraction * (crossing.upperSample.geopotentialHeightGpm - crossing.lowerSample.geopotentialHeightGpm);
    const logPressure = Math.log(crossing.lowerSample.pressureHpa)
      + crossing.fraction * (Math.log(crossing.upperSample.pressureHpa) - Math.log(crossing.lowerSample.pressureHpa));
    return {
      pressureHpa: Math.exp(logPressure),
      geopotentialHeightGpm,
      method: "interpolated" as const,
      transition: crossingTransition(crossing.direction),
      lowerLevel: crossing.lowerSample,
      upperLevel: crossing.upperSample,
    };
  });
}

export function deriveTemperatureInversionLayers(
  levels: readonly SampledThermodynamicLevel[],
): TemperatureInversionLayer[] {
  const layers = findContiguousLayers(
    levels,
    (gradient) => gradient.deltaValue > 0,
    (level) => level.temperatureC,
  );

  return layers.map((layer) => {
    const base = layer.baseSample;
    const top = layer.topSample;
    const depthGpm = top.geopotentialHeightGpm - base.geopotentialHeightGpm;
    const temperatureIncreaseC = top.temperatureC - base.temperatureC;
    if (!(depthGpm > 0) || !(temperatureIncreaseC > 0)) {
      throw new Error("Internal inversion-layer construction error");
    }
    return {
      basePressureHpa: base.pressureHpa,
      topPressureHpa: top.pressureHpa,
      baseGeopotentialHeightGpm: base.geopotentialHeightGpm,
      topGeopotentialHeightGpm: top.geopotentialHeightGpm,
      baseTemperatureC: base.temperatureC,
      topTemperatureC: top.temperatureC,
      depthGpm,
      temperatureIncreaseC,
      meanTemperatureGradientCPerKm: temperatureIncreaseC / depthGpm * 1000,
      sampledSegments: layer.sampledSegments,
    };
  });
}

function crossingTransition(direction: "increasing" | "decreasing" | "indeterminate"): FreezingCrossingTransition {
  if (direction === "increasing") return "cold_to_warm";
  if (direction === "decreasing") return "warm_to_cold";
  return "indeterminate";
}
