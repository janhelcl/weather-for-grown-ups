import type { GefsPressureVariableId, GefsProfileVariableId } from "../catalog/gefs.js";
import { deriveSpecificHumidityFromRelativeHumidityKgKg } from "../derived/humidity.js";
import {
  deriveAirDensityKgM3,
  deriveDewPointC,
  deriveEquivalentPotentialTemperatureK,
  deriveMixingRatioKgKg,
  derivePotentialTemperatureK,
  deriveVirtualTemperatureC,
  deriveWetBulbTemperatureC,
} from "../derived/thermodynamics.js";

export function deriveGefsProfileValue(
  variable: GefsProfileVariableId,
  pressureLevelHpa: number,
  rawValues: ReadonlyMap<string, number>,
): number {
  const temperature = () => requireGefsRawPressure(rawValues, "temperature", pressureLevelHpa);
  const relativeHumidity = () => requireGefsRawPressure(rawValues, "relative_humidity", pressureLevelHpa);
  const specificHumidity = () => deriveSpecificHumidityFromRelativeHumidityKgKg(
    temperature(),
    relativeHumidity(),
    pressureLevelHpa,
  );

  switch (variable) {
    case "dew_point":
      return deriveDewPointC(temperature(), relativeHumidity());
    case "potential_temperature":
      return derivePotentialTemperatureK(temperature(), pressureLevelHpa);
    case "specific_humidity":
      return specificHumidity();
    case "mixing_ratio":
      return deriveMixingRatioKgKg(specificHumidity());
    case "virtual_temperature":
      return deriveVirtualTemperatureC(temperature(), specificHumidity());
    case "air_density":
      return deriveAirDensityKgM3(temperature(), specificHumidity(), pressureLevelHpa);
    case "wet_bulb_temperature":
      return deriveWetBulbTemperatureC(temperature(), specificHumidity(), pressureLevelHpa);
    case "equivalent_potential_temperature":
      return deriveEquivalentPotentialTemperatureK(temperature(), specificHumidity(), pressureLevelHpa);
    default:
      return requireGefsRawPressure(rawValues, variable, pressureLevelHpa);
  }
}

export function requireGefsRawPressure(
  values: ReadonlyMap<string, number>,
  variable: GefsPressureVariableId,
  pressureLevelHpa: number,
): number {
  const value = values.get(gefsRawPressureKey(variable, pressureLevelHpa));
  if (value === undefined) {
    throw new Error(`Internal GEFS derived-variable dependency missing: ${variable}@${pressureLevelHpa}mb`);
  }
  return value;
}

export function gefsRawPressureKey(variable: GefsPressureVariableId, pressureLevelHpa: number): string {
  return `${variable}@${pressureLevelHpa}`;
}
