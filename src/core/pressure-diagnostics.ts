import type { LayerDiagnosticId } from "../catalog/layer-diagnostics.js";
import type { ProfileDiagnosticId } from "../catalog/profile-diagnostics.js";
import {
  deriveLayerDepthGpm,
  derivePotentialTemperatureGradientKPerKm,
  deriveTemperatureLapseRateCPerKm,
  deriveWindShear,
} from "../derived/layer-diagnostics.js";
import {
  deriveFreezingLevelCrossings,
  deriveTemperatureInversionLayers,
  type SampledThermodynamicLevel,
} from "../derived/profile-diagnostics.js";
import type {
  LayerDiagnosticResult,
  ProfileDiagnosticResult,
  ProfileLevel,
} from "./types.js";

export function deriveLayerDiagnosticsFromLevels(
  levels: readonly ProfileLevel[],
  lowerPressureHpa: number,
  upperPressureHpa: number,
  diagnostics: readonly LayerDiagnosticId[],
) {
  const lower = requiredLevel(levels, lowerPressureHpa);
  const upper = requiredLevel(levels, upperPressureHpa);
  const lowerHeightGpm = required(lower.geopotentialHeightGpm, "geopotential_height", lower.pressureHpa);
  const upperHeightGpm = required(upper.geopotentialHeightGpm, "geopotential_height", upper.pressureHpa);
  const depthGpm = deriveLayerDepthGpm(lowerHeightGpm, upperHeightGpm);

  return {
    layer: {
      lowerPressureHpa,
      upperPressureHpa,
      lowerGeopotentialHeightGpm: lowerHeightGpm,
      upperGeopotentialHeightGpm: upperHeightGpm,
      depthGpm,
    },
    levels: [lower, upper],
    diagnostics: diagnostics.map((id) => deriveLayerDiagnostic(id, lower, upper, lowerHeightGpm, upperHeightGpm)),
  };
}

export function deriveProfileDiagnosticsFromLevels(
  levels: readonly ProfileLevel[],
  diagnostics: readonly ProfileDiagnosticId[],
): ProfileDiagnosticResult[] {
  const sampledLevels = levels.map(toSampledLevel);
  return diagnostics.map((id) => deriveProfileDiagnostic(id, sampledLevels));
}

function deriveLayerDiagnostic(
  id: LayerDiagnosticId,
  lower: ProfileLevel,
  upper: ProfileLevel,
  lowerHeightGpm: number,
  upperHeightGpm: number,
): LayerDiagnosticResult {
  switch (id) {
    case "temperature_lapse_rate":
      return {
        id,
        values: {
          temperatureLapseRateCPerKm: deriveTemperatureLapseRateCPerKm(
            required(lower.temperatureC, "temperature", lower.pressureHpa),
            required(upper.temperatureC, "temperature", upper.pressureHpa),
            lowerHeightGpm,
            upperHeightGpm,
          ),
        },
      };
    case "wind_shear":
      return {
        id,
        values: {
          ...deriveWindShear(
            required(lower.uWindMs, "u_wind", lower.pressureHpa),
            required(lower.vWindMs, "v_wind", lower.pressureHpa),
            required(upper.uWindMs, "u_wind", upper.pressureHpa),
            required(upper.vWindMs, "v_wind", upper.pressureHpa),
            lowerHeightGpm,
            upperHeightGpm,
          ),
        },
      };
    case "potential_temperature_gradient":
      return {
        id,
        values: {
          potentialTemperatureGradientKPerKm: derivePotentialTemperatureGradientKPerKm(
            required(lower.temperatureC, "temperature", lower.pressureHpa),
            lower.pressureHpa,
            required(upper.temperatureC, "temperature", upper.pressureHpa),
            upper.pressureHpa,
            lowerHeightGpm,
            upperHeightGpm,
          ),
        },
      };
  }
}

function deriveProfileDiagnostic(
  id: ProfileDiagnosticId,
  levels: readonly SampledThermodynamicLevel[],
): ProfileDiagnosticResult {
  switch (id) {
    case "freezing_level_crossings":
      return { id, crossings: deriveFreezingLevelCrossings(levels) };
    case "temperature_inversion_layers":
      return { id, layers: deriveTemperatureInversionLayers(levels) };
  }
}

function toSampledLevel(level: ProfileLevel): SampledThermodynamicLevel {
  return {
    pressureHpa: level.pressureHpa,
    temperatureC: required(level.temperatureC, "temperature", level.pressureHpa),
    geopotentialHeightGpm: required(level.geopotentialHeightGpm, "geopotential_height", level.pressureHpa),
  };
}

export function requiredPressureLevel(levels: readonly ProfileLevel[], pressureHpa: number): ProfileLevel {
  return requiredLevel(levels, pressureHpa);
}

function requiredLevel(levels: readonly ProfileLevel[], pressureHpa: number): ProfileLevel {
  const level = levels.find((candidate) => candidate.pressureHpa === pressureHpa);
  if (!level) throw new Error(`Profile result is missing required pressure level ${pressureHpa} hPa`);
  return level;
}

function required(value: number | undefined, id: string, pressureHpa: number): number {
  if (value === undefined) throw new Error(`Profile result is missing required ${id}@${pressureHpa}mb`);
  return value;
}
