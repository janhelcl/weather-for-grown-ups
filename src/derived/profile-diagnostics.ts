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
  const ordered = [...levels].sort((a, b) => a.geopotentialHeightGpm - b.geopotentialHeightGpm);
  for (let index = 1; index < ordered.length; index += 1) {
    const lower = ordered[index - 1]!;
    const upper = ordered[index]!;
    if (!(upper.geopotentialHeightGpm > lower.geopotentialHeightGpm)) {
      throw new Error(`Expected strictly increasing geopotential heights, received ${lower.geopotentialHeightGpm} and ${upper.geopotentialHeightGpm} gpm`);
    }
  }
  return ordered;
}

export function deriveFreezingLevelCrossings(
  levels: readonly SampledThermodynamicLevel[],
): FreezingLevelCrossing[] {
  const ordered = orderProfileByHeight(levels);
  const crossings: FreezingLevelCrossing[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const level = ordered[index]!;
    if (level.temperatureC === 0) {
      const lower = ordered[Math.max(0, index - 1)]!;
      const upper = ordered[Math.min(ordered.length - 1, index + 1)]!;
      crossings.push({
        pressureHpa: level.pressureHpa,
        geopotentialHeightGpm: level.geopotentialHeightGpm,
        method: "exact_sample",
        transition: exactSampleTransition(lower.temperatureC, upper.temperatureC),
        lowerLevel: lower,
        upperLevel: upper,
      });
    }
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const lower = ordered[index - 1]!;
    const upper = ordered[index]!;
    if (lower.temperatureC === 0 || upper.temperatureC === 0) continue;
    if (Math.sign(lower.temperatureC) === Math.sign(upper.temperatureC)) continue;

    const fraction = lower.temperatureC / (lower.temperatureC - upper.temperatureC);
    const geopotentialHeightGpm = lower.geopotentialHeightGpm
      + fraction * (upper.geopotentialHeightGpm - lower.geopotentialHeightGpm);
    const logPressure = Math.log(lower.pressureHpa)
      + fraction * (Math.log(upper.pressureHpa) - Math.log(lower.pressureHpa));

    crossings.push({
      pressureHpa: Math.exp(logPressure),
      geopotentialHeightGpm,
      method: "interpolated",
      transition: lower.temperatureC > 0 ? "warm_to_cold" : "cold_to_warm",
      lowerLevel: lower,
      upperLevel: upper,
    });
  }

  return crossings.sort((a, b) => a.geopotentialHeightGpm - b.geopotentialHeightGpm);
}

export function deriveTemperatureInversionLayers(
  levels: readonly SampledThermodynamicLevel[],
): TemperatureInversionLayer[] {
  const ordered = orderProfileByHeight(levels);
  const layers: TemperatureInversionLayer[] = [];
  let inversionStartIndex: number | undefined;

  for (let index = 1; index < ordered.length; index += 1) {
    const lower = ordered[index - 1]!;
    const upper = ordered[index]!;
    const isInversionSegment = upper.temperatureC > lower.temperatureC;

    if (isInversionSegment && inversionStartIndex === undefined) {
      inversionStartIndex = index - 1;
    }

    const isLastSegment = index === ordered.length - 1;
    if (inversionStartIndex !== undefined && (!isInversionSegment || isLastSegment)) {
      const inversionEndIndex = isInversionSegment && isLastSegment ? index : index - 1;
      layers.push(buildInversionLayer(ordered, inversionStartIndex, inversionEndIndex));
      inversionStartIndex = undefined;
    }
  }

  return layers;
}

function buildInversionLayer(
  levels: readonly SampledThermodynamicLevel[],
  baseIndex: number,
  topIndex: number,
): TemperatureInversionLayer {
  const base = levels[baseIndex]!;
  const top = levels[topIndex]!;
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
    sampledSegments: topIndex - baseIndex,
  };
}

function exactSampleTransition(lowerTemperatureC: number, upperTemperatureC: number): FreezingCrossingTransition {
  if (lowerTemperatureC > 0 && upperTemperatureC < 0) return "warm_to_cold";
  if (lowerTemperatureC < 0 && upperTemperatureC > 0) return "cold_to_warm";
  return "indeterminate";
}
