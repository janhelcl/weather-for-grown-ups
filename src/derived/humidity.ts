import {
  deriveSaturationVaporPressureHpa,
  deriveSpecificHumidityFromMixingRatioKgKg,
} from "./thermodynamics.js";

const WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO = 0.622;

/**
 * Convert temperature, relative humidity and total pressure to specific humidity.
 *
 * Relative humidity is interpreted as e / e_s(T). The resulting vapor pressure
 * is converted to mixing ratio and then exact specific humidity. Values above
 * 100% RH are allowed when the implied vapor pressure remains below total
 * pressure so model supersaturation is not silently clipped.
 */
export function deriveSpecificHumidityFromRelativeHumidityKgKg(
  temperatureC: number,
  relativeHumidityPct: number,
  pressureHpa: number,
): number {
  if (!(pressureHpa > 0) || !Number.isFinite(pressureHpa)) {
    throw new Error(`Expected positive finite pressure, received ${pressureHpa} hPa`);
  }
  if (!(relativeHumidityPct >= 0) || !Number.isFinite(relativeHumidityPct)) {
    throw new Error(`Expected non-negative finite relative humidity, received ${relativeHumidityPct}%`);
  }
  if (relativeHumidityPct === 0) return 0;

  const vaporPressureHpa = relativeHumidityPct / 100 * deriveSaturationVaporPressureHpa(temperatureC);
  if (!(vaporPressureHpa < pressureHpa)) {
    throw new Error(
      `Relative humidity implies vapor pressure ${vaporPressureHpa} hPa not below ambient pressure ${pressureHpa} hPa`,
    );
  }
  const mixingRatioKgKg = WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO
    * vaporPressureHpa / (pressureHpa - vaporPressureHpa);
  return deriveSpecificHumidityFromMixingRatioKgKg(mixingRatioKgKg);
}
