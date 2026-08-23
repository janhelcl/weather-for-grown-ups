const KELVIN_OFFSET = 273.15;
const REFERENCE_PRESSURE_HPA = 1000;
const DRY_AIR_GAS_CONSTANT_J_KG_K = 287.05;
const WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO = 0.622;
const POISSON_EXPONENT = 0.2854;
const MIN_RELATIVE_HUMIDITY_PCT = 1e-6;

/**
 * Dew point from temperature and relative humidity using the Magnus form
 * with coefficients 17.625 and 243.04 degC.
 *
 * A tiny RH floor keeps the dry-air limit finite for structured JSON output.
 */
export function deriveDewPointC(temperatureC: number, relativeHumidityPct: number): number {
  const a = 17.625;
  const b = 243.04;
  const rhFraction = Math.max(relativeHumidityPct, MIN_RELATIVE_HUMIDITY_PCT) / 100;
  const gamma = Math.log(rhFraction) + (a * temperatureC) / (b + temperatureC);
  return (b * gamma) / (a - gamma);
}

/** Potential temperature from Poisson's equation using a 1000 hPa reference pressure. */
export function derivePotentialTemperatureK(temperatureC: number, pressureHpa: number): number {
  const temperatureK = temperatureC + KELVIN_OFFSET;
  return temperatureK * Math.pow(REFERENCE_PRESSURE_HPA / pressureHpa, POISSON_EXPONENT);
}

/** Mixing ratio from specific humidity: r = q / (1 - q). */
export function deriveMixingRatioKgKg(specificHumidityKgKg: number): number {
  return specificHumidityKgKg / (1 - specificHumidityKgKg);
}

/** Virtual temperature for moist air, returned in degrees Celsius. */
export function deriveVirtualTemperatureC(
  temperatureC: number,
  specificHumidityKgKg: number,
): number {
  const temperatureK = temperatureC + KELVIN_OFFSET;
  const virtualTemperatureK = temperatureK * (
    1 + (1 / WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO - 1) * specificHumidityKgKg
  );
  return virtualTemperatureK - KELVIN_OFFSET;
}

/** Air density from pressure and virtual temperature using the ideal-gas relation. */
export function deriveAirDensityKgM3(
  temperatureC: number,
  specificHumidityKgKg: number,
  pressureHpa: number,
): number {
  const virtualTemperatureK = deriveVirtualTemperatureC(temperatureC, specificHumidityKgKg) + KELVIN_OFFSET;
  return (pressureHpa * 100) / (DRY_AIR_GAS_CONSTANT_J_KG_K * virtualTemperatureK);
}
