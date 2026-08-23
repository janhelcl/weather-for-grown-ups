const KELVIN_OFFSET = 273.15;
const REFERENCE_PRESSURE_HPA = 1000;
const DRY_AIR_GAS_CONSTANT_J_KG_K = 287.05;
const WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO = 0.622;
const POISSON_EXPONENT = 0.2854;
const MIN_RELATIVE_HUMIDITY_PCT = 1e-6;
const BOLTON_SATURATION_PRESSURE_HPA = 6.112;
const BOLTON_SATURATION_A = 17.67;
const BOLTON_SATURATION_B_C = 243.5;

export interface LclState {
  pressureHpa: number;
  temperatureC: number;
  dewPointC: number;
}

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
  assertPressure(pressureHpa);
  const temperatureK = temperatureC + KELVIN_OFFSET;
  if (!(temperatureK > 0)) throw new Error(`Temperature must be above absolute zero, received ${temperatureC} degC`);
  return temperatureK * Math.pow(REFERENCE_PRESSURE_HPA / pressureHpa, POISSON_EXPONENT);
}

/** Temperature on a dry adiabat from potential temperature and pressure. */
export function deriveTemperatureFromPotentialTemperatureC(potentialTemperatureK: number, pressureHpa: number): number {
  assertPressure(pressureHpa);
  if (!(potentialTemperatureK > 0) || !Number.isFinite(potentialTemperatureK)) {
    throw new Error(`Expected positive finite potential temperature, received ${potentialTemperatureK} K`);
  }
  return potentialTemperatureK * Math.pow(pressureHpa / REFERENCE_PRESSURE_HPA, POISSON_EXPONENT) - KELVIN_OFFSET;
}

/** Dry-adiabatic parcel temperature at a target pressure. */
export function deriveDryAdiabaticTemperatureC(
  startingTemperatureC: number,
  startingPressureHpa: number,
  targetPressureHpa: number,
): number {
  const theta = derivePotentialTemperatureK(startingTemperatureC, startingPressureHpa);
  return deriveTemperatureFromPotentialTemperatureC(theta, targetPressureHpa);
}

/** Mixing ratio from specific humidity: r = q / (1 - q). */
export function deriveMixingRatioKgKg(specificHumidityKgKg: number): number {
  assertSpecificHumidity(specificHumidityKgKg);
  return specificHumidityKgKg / (1 - specificHumidityKgKg);
}

/** Specific humidity from mixing ratio: q = r / (1 + r). */
export function deriveSpecificHumidityFromMixingRatioKgKg(mixingRatioKgKg: number): number {
  if (!(mixingRatioKgKg >= 0) || !Number.isFinite(mixingRatioKgKg)) {
    throw new Error(`Expected non-negative finite mixing ratio, received ${mixingRatioKgKg}`);
  }
  return mixingRatioKgKg / (1 + mixingRatioKgKg);
}

/** Virtual temperature for moist air, returned in Kelvin. */
export function deriveVirtualTemperatureK(
  temperatureC: number,
  specificHumidityKgKg: number,
): number {
  assertSpecificHumidity(specificHumidityKgKg);
  const temperatureK = temperatureC + KELVIN_OFFSET;
  if (!(temperatureK > 0)) throw new Error(`Temperature must be above absolute zero, received ${temperatureC} degC`);
  return temperatureK * (
    1 + (1 / WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO - 1) * specificHumidityKgKg
  );
}

/** Virtual temperature for moist air, returned in degrees Celsius. */
export function deriveVirtualTemperatureC(
  temperatureC: number,
  specificHumidityKgKg: number,
): number {
  return deriveVirtualTemperatureK(temperatureC, specificHumidityKgKg) - KELVIN_OFFSET;
}

/** Air density from pressure and virtual temperature using the ideal-gas relation. */
export function deriveAirDensityKgM3(
  temperatureC: number,
  specificHumidityKgKg: number,
  pressureHpa: number,
): number {
  assertPressure(pressureHpa);
  const virtualTemperatureK = deriveVirtualTemperatureK(temperatureC, specificHumidityKgKg);
  return (pressureHpa * 100) / (DRY_AIR_GAS_CONSTANT_J_KG_K * virtualTemperatureK);
}

/** Saturation vapor pressure over liquid water using Bolton (1980), in hPa. */
export function deriveSaturationVaporPressureHpa(temperatureC: number): number {
  return BOLTON_SATURATION_PRESSURE_HPA * Math.exp(
    BOLTON_SATURATION_A * temperatureC / (temperatureC + BOLTON_SATURATION_B_C),
  );
}

/** Saturation mixing ratio over liquid water at the supplied pressure. */
export function deriveSaturationMixingRatioKgKg(temperatureC: number, pressureHpa: number): number {
  assertPressure(pressureHpa);
  const saturationVaporPressureHpa = deriveSaturationVaporPressureHpa(temperatureC);
  if (!(saturationVaporPressureHpa < pressureHpa)) {
    throw new Error(`Saturation vapor pressure ${saturationVaporPressureHpa} hPa is not below ambient pressure ${pressureHpa} hPa`);
  }
  return WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO
    * saturationVaporPressureHpa / (pressureHpa - saturationVaporPressureHpa);
}

/** Saturation specific humidity over liquid water at the supplied pressure. */
export function deriveSaturationSpecificHumidityKgKg(temperatureC: number, pressureHpa: number): number {
  return deriveSpecificHumidityFromMixingRatioKgKg(deriveSaturationMixingRatioKgKg(temperatureC, pressureHpa));
}

/** Water-vapor partial pressure from total pressure and specific humidity. */
export function deriveVaporPressureHpa(specificHumidityKgKg: number, pressureHpa: number): number {
  assertSpecificHumidity(specificHumidityKgKg);
  assertPressure(pressureHpa);
  const mixingRatio = deriveMixingRatioKgKg(specificHumidityKgKg);
  return pressureHpa * mixingRatio / (WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO + mixingRatio);
}

/** Dew point obtained by inverting the Bolton (1980) saturation-vapor-pressure relation. */
export function deriveDewPointFromVaporPressureC(vaporPressureHpa: number): number {
  if (!(vaporPressureHpa > 0) || !Number.isFinite(vaporPressureHpa)) {
    throw new Error(`Expected positive finite vapor pressure, received ${vaporPressureHpa} hPa`);
  }
  const logRatio = Math.log(vaporPressureHpa / BOLTON_SATURATION_PRESSURE_HPA);
  return BOLTON_SATURATION_B_C * logRatio / (BOLTON_SATURATION_A - logRatio);
}

/** Bolton (1980) lifted-condensation-level temperature and dry-adiabatic pressure. */
export function deriveLclState(
  temperatureC: number,
  specificHumidityKgKg: number,
  pressureHpa: number,
): LclState {
  assertPressure(pressureHpa);
  assertSpecificHumidity(specificHumidityKgKg);
  if (!(specificHumidityKgKg > 0)) throw new Error("LCL is undefined for zero specific humidity");

  const temperatureK = temperatureC + KELVIN_OFFSET;
  if (!(temperatureK > 0)) throw new Error(`Temperature must be above absolute zero, received ${temperatureC} degC`);
  const dewPointC = deriveDewPointFromVaporPressureC(deriveVaporPressureHpa(specificHumidityKgKg, pressureHpa));
  const dewPointK = dewPointC + KELVIN_OFFSET;
  const lclTemperatureK = 56 + 1 / (
    1 / (dewPointK - 56) + Math.log(temperatureK / dewPointK) / 800
  );
  const lclPressureHpa = pressureHpa * Math.pow(lclTemperatureK / temperatureK, 1 / POISSON_EXPONENT);
  return {
    pressureHpa: lclPressureHpa,
    temperatureC: lclTemperatureK - KELVIN_OFFSET,
    dewPointC,
  };
}

/**
 * Equivalent potential temperature following Bolton (1980).
 *
 * The parcel moisture state is supplied as specific humidity. Vapor pressure
 * and dew point are recovered from q and the isobaric pressure, then Bolton's
 * LCL-temperature and theta-e equations are applied. At q=0 the expression
 * reduces to dry potential temperature.
 */
export function deriveEquivalentPotentialTemperatureK(
  temperatureC: number,
  specificHumidityKgKg: number,
  pressureHpa: number,
): number {
  assertPressure(pressureHpa);
  assertSpecificHumidity(specificHumidityKgKg);
  const temperatureK = temperatureC + KELVIN_OFFSET;
  if (!(temperatureK > 0)) throw new Error(`Temperature must be above absolute zero, received ${temperatureC} degC`);
  if (specificHumidityKgKg === 0) return derivePotentialTemperatureK(temperatureC, pressureHpa);

  const mixingRatio = deriveMixingRatioKgKg(specificHumidityKgKg);
  const vaporPressureHpa = deriveVaporPressureHpa(specificHumidityKgKg, pressureHpa);
  const lcl = deriveLclState(temperatureC, specificHumidityKgKg, pressureHpa);
  const lclTemperatureK = lcl.temperatureC + KELVIN_OFFSET;
  const dryPotentialAtLclK = temperatureK
    * Math.pow(REFERENCE_PRESSURE_HPA / (pressureHpa - vaporPressureHpa), POISSON_EXPONENT)
    * Math.pow(temperatureK / lclTemperatureK, 0.28 * mixingRatio);

  return dryPotentialAtLclK * Math.exp(
    (3036 / lclTemperatureK - 1.78)
    * mixingRatio
    * (1 + 0.448 * mixingRatio),
  );
}

/**
 * Thermodynamic wet-bulb temperature from an adiabatic-saturation enthalpy balance.
 *
 * At the same pressure, solve for the saturated temperature whose moist-air
 * enthalpy equals the input parcel enthalpy. The solve is deterministic bisection
 * and retains pressure dependence through the saturation mixing ratio.
 */
export function deriveWetBulbTemperatureC(
  temperatureC: number,
  specificHumidityKgKg: number,
  pressureHpa: number,
): number {
  assertPressure(pressureHpa);
  assertSpecificHumidity(specificHumidityKgKg);
  const mixingRatio = deriveMixingRatioKgKg(specificHumidityKgKg);
  const targetEnthalpy = moistAirEnthalpyKjKgDryAir(temperatureC, mixingRatio);
  const dewPointC = specificHumidityKgKg === 0
    ? temperatureC - 100
    : deriveDewPointFromVaporPressureC(deriveVaporPressureHpa(specificHumidityKgKg, pressureHpa));

  let lowerC = Math.min(temperatureC, dewPointC) - 40;
  let upperC = Math.max(temperatureC, dewPointC) + 10;
  let lowerResidual = saturatedEnthalpyResidual(lowerC, pressureHpa, targetEnthalpy);
  let upperResidual = saturatedEnthalpyResidual(upperC, pressureHpa, targetEnthalpy);

  for (let attempt = 0; lowerResidual > 0 && attempt < 8; attempt += 1) {
    lowerC -= 20;
    lowerResidual = saturatedEnthalpyResidual(lowerC, pressureHpa, targetEnthalpy);
  }
  for (let attempt = 0; upperResidual < 0 && attempt < 8; attempt += 1) {
    upperC += 10;
    upperResidual = saturatedEnthalpyResidual(upperC, pressureHpa, targetEnthalpy);
  }
  if (!(lowerResidual <= 0 && upperResidual >= 0)) {
    throw new Error(`Could not bracket wet-bulb solution at ${pressureHpa} hPa`);
  }

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpointC = (lowerC + upperC) / 2;
    const residual = saturatedEnthalpyResidual(midpointC, pressureHpa, targetEnthalpy);
    if (residual > 0) upperC = midpointC;
    else lowerC = midpointC;
  }
  return (lowerC + upperC) / 2;
}

function saturatedEnthalpyResidual(temperatureC: number, pressureHpa: number, targetEnthalpy: number): number {
  const saturationMixingRatio = deriveSaturationMixingRatioKgKg(temperatureC, pressureHpa);
  return moistAirEnthalpyKjKgDryAir(temperatureC, saturationMixingRatio) - targetEnthalpy;
}

function moistAirEnthalpyKjKgDryAir(temperatureC: number, mixingRatioKgKg: number): number {
  return 1.006 * temperatureC + mixingRatioKgKg * (2501 + 1.86 * temperatureC);
}

function assertSpecificHumidity(specificHumidityKgKg: number): void {
  if (!(specificHumidityKgKg >= 0 && specificHumidityKgKg < 1) || !Number.isFinite(specificHumidityKgKg)) {
    throw new Error(`Expected specific humidity in [0, 1), received ${specificHumidityKgKg}`);
  }
}

function assertPressure(pressureHpa: number): void {
  if (!(pressureHpa > 0) || !Number.isFinite(pressureHpa)) {
    throw new Error(`Expected positive finite pressure, received ${pressureHpa} hPa`);
  }
}
