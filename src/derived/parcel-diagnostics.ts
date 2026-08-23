import type { ParcelDefinitionId } from "../catalog/parcel-diagnostics.js";
import {
  deriveDryAdiabaticTemperatureC,
  deriveEquivalentPotentialTemperatureK,
  deriveLclState,
  deriveMixingRatioKgKg,
  derivePotentialTemperatureK,
  deriveSaturationMixingRatioKgKg,
  deriveSaturationSpecificHumidityKgKg,
  deriveSpecificHumidityFromMixingRatioKgKg,
  deriveTemperatureFromPotentialTemperatureC,
  deriveVirtualTemperatureK,
} from "./thermodynamics.js";

const DRY_AIR_GAS_CONSTANT_J_KG_K = 287.05;
const DRY_AIR_CP_J_KG_K = 1004;
const LATENT_HEAT_VAPORIZATION_J_KG = 2.5e6;
const EPSILON = 0.622;
const MAX_MOIST_LOG_PRESSURE_STEP = 0.0025;

export interface ParcelEnvironmentLevel {
  pressureHpa: number;
  geopotentialHeightGpm: number;
  temperatureC: number;
  specificHumidityKgKg: number;
}

export interface ParcelStartingState extends ParcelEnvironmentLevel {
  definition: ParcelDefinitionId;
  source: "surface_2m" | "mixed_layer_mean" | "isobaric_sample";
  construction?: {
    layerBottomPressureHpa?: number;
    layerTopPressureHpa?: number;
    sampledLevels?: number;
    selectedEquivalentPotentialTemperatureK?: number;
    candidateLevels?: number;
  };
}

export interface ParcelPathLevel {
  pressureHpa: number;
  geopotentialHeightGpm: number;
  source: "parcel_start" | "sampled" | "interpolated_lcl" | "interpolated_buoyancy_crossing";
  phase: "dry" | "saturated";
  environmentTemperatureC: number;
  environmentSpecificHumidityKgKg: number;
  environmentVirtualTemperatureK: number;
  parcelTemperatureC: number;
  parcelSpecificHumidityKgKg: number;
  parcelVirtualTemperatureK: number;
  virtualTemperatureExcessK: number;
}

export interface ParcelBoundary {
  pressureHpa: number;
  geopotentialHeightGpm?: number;
}

export interface ParcelComputation {
  startingState: ParcelStartingState;
  lcl: ParcelBoundary & { temperatureC: number; dewPointC: number; withinProfile: boolean };
  lfc?: ParcelBoundary;
  el?: ParcelBoundary;
  capeJkg: number;
  cinJkg: number;
  capeTop: "equilibrium_level" | "profile_top" | "no_lfc";
  cinTop: "lfc" | "profile_top";
  parcelPath: ParcelPathLevel[];
}

export function deriveParcelComputation(
  definition: ParcelDefinitionId,
  surface: ParcelEnvironmentLevel,
  sampledEnvironment: readonly ParcelEnvironmentLevel[],
): ParcelComputation {
  const environment = normalizeEnvironment(surface, sampledEnvironment);
  const startingState = selectParcelStartingState(definition, environment);
  const pathEnvironment = environment.filter((level) => level.pressureHpa <= startingState.pressureHpa + 1e-9);
  if (pathEnvironment.length < 2) throw new Error("Parcel diagnostics require at least two environmental levels at or above the parcel start");

  const lclState = deriveLclState(
    startingState.temperatureC,
    startingState.specificHumidityKgKg,
    startingState.pressureHpa,
  );
  const topPressureHpa = pathEnvironment.at(-1)!.pressureHpa;
  const lclWithinProfile = lclState.pressureHpa >= topPressureHpa && lclState.pressureHpa <= startingState.pressureHpa;
  const lclEnvironment = lclWithinProfile
    ? interpolateEnvironmentAtPressure(pathEnvironment, lclState.pressureHpa)
    : undefined;

  const basePressures = [...new Set([
    startingState.pressureHpa,
    ...pathEnvironment.map((level) => level.pressureHpa),
    ...(lclWithinProfile ? [lclState.pressureHpa] : []),
  ])].sort((a, b) => b - a);

  const basePath = basePressures.map((pressureHpa) => {
    const env = pressureEqual(pressureHpa, startingState.pressureHpa)
      ? environmentAtStart(startingState, pathEnvironment)
      : interpolateEnvironmentAtPressure(pathEnvironment, pressureHpa);
    return buildParcelPathLevel(
      startingState,
      lclState.pressureHpa,
      lclState.temperatureC,
      env,
      pressureEqual(pressureHpa, startingState.pressureHpa)
        ? "parcel_start"
        : pressureEqual(pressureHpa, lclState.pressureHpa)
          ? "interpolated_lcl"
          : "sampled",
    );
  });

  const parcelPath = insertBuoyancyCrossings(basePath);
  const lfc = lclWithinProfile ? findLfc(parcelPath, lclState.pressureHpa) : undefined;
  const el = lfc ? findEl(parcelPath, lfc.pressureHpa) : undefined;
  const capeTopPressureHpa = lfc ? (el?.pressureHpa ?? topPressureHpa) : undefined;
  const cinTopPressureHpa = lfc?.pressureHpa ?? topPressureHpa;

  const capeJkg = lfc && capeTopPressureHpa !== undefined
    ? integrateBuoyancyEnergy(parcelPath, lfc.pressureHpa, capeTopPressureHpa, "positive")
    : 0;
  const cinJkg = integrateBuoyancyEnergy(parcelPath, startingState.pressureHpa, cinTopPressureHpa, "negative");

  return {
    startingState,
    lcl: {
      pressureHpa: lclState.pressureHpa,
      temperatureC: lclState.temperatureC,
      dewPointC: lclState.dewPointC,
      withinProfile: lclWithinProfile,
      ...(lclEnvironment === undefined ? {} : { geopotentialHeightGpm: lclEnvironment.geopotentialHeightGpm }),
    },
    ...(lfc === undefined ? {} : { lfc }),
    ...(el === undefined ? {} : { el }),
    capeJkg: Math.max(0, capeJkg),
    cinJkg: Math.min(0, cinJkg),
    capeTop: !lfc ? "no_lfc" : el ? "equilibrium_level" : "profile_top",
    cinTop: lfc ? "lfc" : "profile_top",
    parcelPath,
  };
}

function normalizeEnvironment(
  surface: ParcelEnvironmentLevel,
  sampledEnvironment: readonly ParcelEnvironmentLevel[],
): ParcelEnvironmentLevel[] {
  const levels = [
    surface,
    ...sampledEnvironment.filter((level) => level.pressureHpa < surface.pressureHpa - 1e-9),
  ].sort((a, b) => b.pressureHpa - a.pressureHpa);

  for (let index = 1; index < levels.length; index += 1) {
    const lower = levels[index - 1]!;
    const upper = levels[index]!;
    if (!(upper.pressureHpa < lower.pressureHpa)) {
      throw new Error(`Expected pressure to decrease upward, received ${lower.pressureHpa} then ${upper.pressureHpa} hPa`);
    }
    if (!(upper.geopotentialHeightGpm > lower.geopotentialHeightGpm)) {
      throw new Error(`Expected geopotential height to increase upward, received ${lower.geopotentialHeightGpm} then ${upper.geopotentialHeightGpm} gpm`);
    }
  }
  return levels;
}

function selectParcelStartingState(
  definition: ParcelDefinitionId,
  environment: readonly ParcelEnvironmentLevel[],
): ParcelStartingState {
  const surface = environment[0]!;
  switch (definition) {
    case "surface_2m":
      return { ...surface, definition, source: "surface_2m" };
    case "mixed_layer_100hpa":
      return mixedLayerStartingState(definition, environment, 100);
    case "most_unstable_300hpa":
      return mostUnstableStartingState(definition, environment, 300);
  }
}

function mixedLayerStartingState(
  definition: ParcelDefinitionId,
  environment: readonly ParcelEnvironmentLevel[],
  depthHpa: number,
): ParcelStartingState {
  const surface = environment[0]!;
  const topPressureHpa = surface.pressureHpa - depthHpa;
  if (environment.at(-1)!.pressureHpa > topPressureHpa) {
    throw new Error(`The sampled profile does not reach the top of the ${depthHpa} hPa mixed layer (${topPressureHpa} hPa)`);
  }

  const topBoundary = interpolateEnvironmentAtPressure(environment, topPressureHpa);
  const layerLevels = [
    surface,
    ...environment.slice(1).filter((level) => level.pressureHpa > topPressureHpa),
    topBoundary,
  ].sort((a, b) => b.pressureHpa - a.pressureHpa);

  const meanThetaK = pressureWeightedMean(layerLevels, (level) =>
    derivePotentialTemperatureK(level.temperatureC, level.pressureHpa));
  const meanMixingRatio = pressureWeightedMean(layerLevels, (level) =>
    deriveMixingRatioKgKg(level.specificHumidityKgKg));

  return {
    definition,
    source: "mixed_layer_mean",
    pressureHpa: surface.pressureHpa,
    geopotentialHeightGpm: surface.geopotentialHeightGpm,
    temperatureC: deriveTemperatureFromPotentialTemperatureC(meanThetaK, surface.pressureHpa),
    specificHumidityKgKg: deriveSpecificHumidityFromMixingRatioKgKg(meanMixingRatio),
    construction: {
      layerBottomPressureHpa: surface.pressureHpa,
      layerTopPressureHpa: topPressureHpa,
      sampledLevels: layerLevels.length,
    },
  };
}

function mostUnstableStartingState(
  definition: ParcelDefinitionId,
  environment: readonly ParcelEnvironmentLevel[],
  depthHpa: number,
): ParcelStartingState {
  const surface = environment[0]!;
  const topPressureHpa = surface.pressureHpa - depthHpa;
  const candidates = environment.filter((level) => level.pressureHpa >= topPressureHpa);
  if (candidates.length === 0) throw new Error("No sampled levels are available in the most-unstable search layer");

  let selected = candidates[0]!;
  let selectedThetaE = deriveEquivalentPotentialTemperatureK(
    selected.temperatureC,
    selected.specificHumidityKgKg,
    selected.pressureHpa,
  );
  for (const candidate of candidates.slice(1)) {
    const thetaE = deriveEquivalentPotentialTemperatureK(
      candidate.temperatureC,
      candidate.specificHumidityKgKg,
      candidate.pressureHpa,
    );
    if (thetaE > selectedThetaE) {
      selected = candidate;
      selectedThetaE = thetaE;
    }
  }

  return {
    ...selected,
    definition,
    source: selected === surface ? "surface_2m" : "isobaric_sample",
    construction: {
      layerBottomPressureHpa: surface.pressureHpa,
      layerTopPressureHpa: topPressureHpa,
      selectedEquivalentPotentialTemperatureK: selectedThetaE,
      candidateLevels: candidates.length,
    },
  };
}

function pressureWeightedMean(
  levels: readonly ParcelEnvironmentLevel[],
  valueOf: (level: ParcelEnvironmentLevel) => number,
): number {
  let integral = 0;
  let pressureDepth = 0;
  for (let index = 1; index < levels.length; index += 1) {
    const lower = levels[index - 1]!;
    const upper = levels[index]!;
    const dp = lower.pressureHpa - upper.pressureHpa;
    integral += 0.5 * (valueOf(lower) + valueOf(upper)) * dp;
    pressureDepth += dp;
  }
  if (!(pressureDepth > 0)) throw new Error("Mixed-layer pressure depth must be positive");
  return integral / pressureDepth;
}

function environmentAtStart(
  startingState: ParcelStartingState,
  environment: readonly ParcelEnvironmentLevel[],
): ParcelEnvironmentLevel {
  const exact = environment.find((level) => pressureEqual(level.pressureHpa, startingState.pressureHpa));
  if (exact) return exact;
  return interpolateEnvironmentAtPressure(environment, startingState.pressureHpa);
}

export function interpolateEnvironmentAtPressure(
  environment: readonly ParcelEnvironmentLevel[],
  pressureHpa: number,
): ParcelEnvironmentLevel {
  const exact = environment.find((level) => pressureEqual(level.pressureHpa, pressureHpa));
  if (exact) return { ...exact };

  for (let index = 1; index < environment.length; index += 1) {
    const lower = environment[index - 1]!;
    const upper = environment[index]!;
    if (pressureHpa < lower.pressureHpa && pressureHpa > upper.pressureHpa) {
      const lowerLogP = Math.log(lower.pressureHpa);
      const upperLogP = Math.log(upper.pressureHpa);
      const fraction = (Math.log(pressureHpa) - lowerLogP) / (upperLogP - lowerLogP);
      return {
        pressureHpa,
        geopotentialHeightGpm: interpolate(lower.geopotentialHeightGpm, upper.geopotentialHeightGpm, fraction),
        temperatureC: interpolate(lower.temperatureC, upper.temperatureC, fraction),
        specificHumidityKgKg: interpolate(lower.specificHumidityKgKg, upper.specificHumidityKgKg, fraction),
      };
    }
  }
  throw new Error(`Pressure ${pressureHpa} hPa is outside the sampled environmental profile`);
}

function buildParcelPathLevel(
  start: ParcelStartingState,
  lclPressureHpa: number,
  lclTemperatureC: number,
  environment: ParcelEnvironmentLevel,
  source: ParcelPathLevel["source"],
): ParcelPathLevel {
  const pressureHpa = environment.pressureHpa;
  const saturated = pressureHpa < lclPressureHpa - 1e-9;
  const parcelTemperatureC = saturated
    ? integratePseudoAdiabaticTemperatureC(lclTemperatureC, lclPressureHpa, pressureHpa)
    : deriveDryAdiabaticTemperatureC(start.temperatureC, start.pressureHpa, pressureHpa);
  const parcelSpecificHumidityKgKg = saturated
    ? deriveSaturationSpecificHumidityKgKg(parcelTemperatureC, pressureHpa)
    : start.specificHumidityKgKg;
  const environmentVirtualTemperatureK = deriveVirtualTemperatureK(
    environment.temperatureC,
    environment.specificHumidityKgKg,
  );
  const parcelVirtualTemperatureK = deriveVirtualTemperatureK(parcelTemperatureC, parcelSpecificHumidityKgKg);

  return {
    pressureHpa,
    geopotentialHeightGpm: environment.geopotentialHeightGpm,
    source,
    phase: saturated ? "saturated" : "dry",
    environmentTemperatureC: environment.temperatureC,
    environmentSpecificHumidityKgKg: environment.specificHumidityKgKg,
    environmentVirtualTemperatureK,
    parcelTemperatureC,
    parcelSpecificHumidityKgKg,
    parcelVirtualTemperatureK,
    virtualTemperatureExcessK: parcelVirtualTemperatureK - environmentVirtualTemperatureK,
  };
}

export function integratePseudoAdiabaticTemperatureC(
  startingTemperatureC: number,
  startingPressureHpa: number,
  targetPressureHpa: number,
): number {
  if (!(targetPressureHpa > 0 && targetPressureHpa <= startingPressureHpa)) {
    throw new Error(`Pseudo-adiabatic target pressure must be in (0, ${startingPressureHpa}], received ${targetPressureHpa} hPa`);
  }
  if (pressureEqual(targetPressureHpa, startingPressureHpa)) return startingTemperatureC;

  let x = Math.log(startingPressureHpa);
  const targetX = Math.log(targetPressureHpa);
  let temperatureK = startingTemperatureC + 273.15;
  const steps = Math.max(1, Math.ceil(Math.abs(targetX - x) / MAX_MOIST_LOG_PRESSURE_STEP));
  const h = (targetX - x) / steps;

  for (let step = 0; step < steps; step += 1) {
    const k1 = moistTemperatureDerivativeKPerLogPressure(x, temperatureK);
    const k2 = moistTemperatureDerivativeKPerLogPressure(x + h / 2, temperatureK + h * k1 / 2);
    const k3 = moistTemperatureDerivativeKPerLogPressure(x + h / 2, temperatureK + h * k2 / 2);
    const k4 = moistTemperatureDerivativeKPerLogPressure(x + h, temperatureK + h * k3);
    temperatureK += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
    x += h;
  }
  return temperatureK - 273.15;
}

/**
 * Pseudo-adiabatic saturated ascent in pressure coordinates.
 *
 * This is dT/dln(p) obtained directly from the standard moist-lapse ODE,
 * avoiding a hydrostatic height conversion that would incorrectly introduce
 * virtual temperature into the parcel-temperature tendency.
 */
function moistTemperatureDerivativeKPerLogPressure(logPressure: number, temperatureK: number): number {
  const pressureHpa = Math.exp(logPressure);
  const temperatureC = temperatureK - 273.15;
  const saturationMixingRatio = deriveSaturationMixingRatioKgKg(temperatureC, pressureHpa);
  return (
    DRY_AIR_GAS_CONSTANT_J_KG_K * temperatureK
    + LATENT_HEAT_VAPORIZATION_J_KG * saturationMixingRatio
  ) / (
    DRY_AIR_CP_J_KG_K
    + LATENT_HEAT_VAPORIZATION_J_KG * LATENT_HEAT_VAPORIZATION_J_KG
      * saturationMixingRatio * EPSILON
      / (DRY_AIR_GAS_CONSTANT_J_KG_K * temperatureK * temperatureK)
  );
}

function insertBuoyancyCrossings(path: readonly ParcelPathLevel[]): ParcelPathLevel[] {
  const output: ParcelPathLevel[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const current = path[index]!;
    if (index > 0) {
      const previous = path[index - 1]!;
      const a = previous.virtualTemperatureExcessK;
      const b = current.virtualTemperatureExcessK;
      if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) {
        const fraction = a / (a - b);
        output.push(interpolatePathLevel(previous, current, fraction, "interpolated_buoyancy_crossing"));
      }
    }
    output.push(current);
  }
  return output;
}

function interpolatePathLevel(
  lower: ParcelPathLevel,
  upper: ParcelPathLevel,
  fraction: number,
  source: ParcelPathLevel["source"],
): ParcelPathLevel {
  const logPressure = interpolate(Math.log(lower.pressureHpa), Math.log(upper.pressureHpa), fraction);
  const environmentTemperatureC = interpolate(lower.environmentTemperatureC, upper.environmentTemperatureC, fraction);
  const environmentSpecificHumidityKgKg = interpolate(lower.environmentSpecificHumidityKgKg, upper.environmentSpecificHumidityKgKg, fraction);
  const parcelTemperatureC = interpolate(lower.parcelTemperatureC, upper.parcelTemperatureC, fraction);
  const parcelSpecificHumidityKgKg = interpolate(lower.parcelSpecificHumidityKgKg, upper.parcelSpecificHumidityKgKg, fraction);
  const environmentVirtualTemperatureK = interpolate(lower.environmentVirtualTemperatureK, upper.environmentVirtualTemperatureK, fraction);
  const parcelVirtualTemperatureK = interpolate(lower.parcelVirtualTemperatureK, upper.parcelVirtualTemperatureK, fraction);
  return {
    pressureHpa: Math.exp(logPressure),
    geopotentialHeightGpm: interpolate(lower.geopotentialHeightGpm, upper.geopotentialHeightGpm, fraction),
    source,
    phase: fraction < 0.5 ? lower.phase : upper.phase,
    environmentTemperatureC,
    environmentSpecificHumidityKgKg,
    environmentVirtualTemperatureK,
    parcelTemperatureC,
    parcelSpecificHumidityKgKg,
    parcelVirtualTemperatureK,
    virtualTemperatureExcessK: 0,
  };
}

function findLfc(path: readonly ParcelPathLevel[], lclPressureHpa: number): ParcelBoundary | undefined {
  const aboveLcl = path.filter((level) => level.pressureHpa <= lclPressureHpa + 1e-9);
  for (let index = 0; index < aboveLcl.length; index += 1) {
    const level = aboveLcl[index]!;
    const next = aboveLcl[index + 1];
    if (level.virtualTemperatureExcessK > 0) {
      return boundary(level);
    }
    if (level.virtualTemperatureExcessK === 0 && next && next.virtualTemperatureExcessK > 0) {
      return boundary(level);
    }
  }
  return undefined;
}

function findEl(path: readonly ParcelPathLevel[], lfcPressureHpa: number): ParcelBoundary | undefined {
  const aboveLfc = path.filter((level) => level.pressureHpa <= lfcPressureHpa + 1e-9);
  let seenPositive = false;
  for (let index = 0; index < aboveLfc.length; index += 1) {
    const level = aboveLfc[index]!;
    if (level.virtualTemperatureExcessK > 0) seenPositive = true;
    if (seenPositive && level.virtualTemperatureExcessK === 0) {
      const next = aboveLfc[index + 1];
      if (!next || next.virtualTemperatureExcessK < 0) return boundary(level);
    }
    if (seenPositive && level.virtualTemperatureExcessK < 0) return boundary(level);
  }
  return undefined;
}

function boundary(level: ParcelPathLevel): ParcelBoundary {
  return { pressureHpa: level.pressureHpa, geopotentialHeightGpm: level.geopotentialHeightGpm };
}

function integrateBuoyancyEnergy(
  path: readonly ParcelPathLevel[],
  bottomPressureHpa: number,
  topPressureHpa: number,
  sign: "positive" | "negative",
): number {
  const levels = path.filter((level) =>
    level.pressureHpa <= bottomPressureHpa + 1e-9 && level.pressureHpa >= topPressureHpa - 1e-9);
  let energy = 0;
  for (let index = 1; index < levels.length; index += 1) {
    const lower = levels[index - 1]!;
    const upper = levels[index]!;
    const meanExcess = 0.5 * (lower.virtualTemperatureExcessK + upper.virtualTemperatureExcessK);
    if ((sign === "positive" && meanExcess <= 0) || (sign === "negative" && meanExcess >= 0)) continue;
    energy += -DRY_AIR_GAS_CONSTANT_J_KG_K
      * meanExcess
      * (Math.log(upper.pressureHpa) - Math.log(lower.pressureHpa));
  }
  return energy;
}

function interpolate(a: number, b: number, fraction: number): number {
  return a + fraction * (b - a);
}

function pressureEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
}
