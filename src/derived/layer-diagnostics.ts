import { derivePotentialTemperatureK } from "./thermodynamics.js";

const METRES_PER_KILOMETRE = 1000;

export function deriveLayerDepthGpm(lowerHeightGpm: number, upperHeightGpm: number): number {
  const depthGpm = upperHeightGpm - lowerHeightGpm;
  if (!(depthGpm > 0)) {
    throw new Error(`Expected upper geopotential height to exceed lower geopotential height, received ${lowerHeightGpm} → ${upperHeightGpm} gpm`);
  }
  return depthGpm;
}

/** Conventional environmental lapse rate: positive when temperature decreases with height. */
export function deriveTemperatureLapseRateCPerKm(
  lowerTemperatureC: number,
  upperTemperatureC: number,
  lowerHeightGpm: number,
  upperHeightGpm: number,
): number {
  const depthGpm = deriveLayerDepthGpm(lowerHeightGpm, upperHeightGpm);
  return (lowerTemperatureC - upperTemperatureC) / depthGpm * METRES_PER_KILOMETRE;
}

export interface WindShear {
  uWindShearMs: number;
  vWindShearMs: number;
  windShearMagnitudeMs: number;
  windShearMsPerKm: number;
}

/** Vector wind change from lower to upper pressure surface. */
export function deriveWindShear(
  lowerUWindMs: number,
  lowerVWindMs: number,
  upperUWindMs: number,
  upperVWindMs: number,
  lowerHeightGpm: number,
  upperHeightGpm: number,
): WindShear {
  const depthGpm = deriveLayerDepthGpm(lowerHeightGpm, upperHeightGpm);
  const uWindShearMs = upperUWindMs - lowerUWindMs;
  const vWindShearMs = upperVWindMs - lowerVWindMs;
  const windShearMagnitudeMs = Math.hypot(uWindShearMs, vWindShearMs);
  return {
    uWindShearMs,
    vWindShearMs,
    windShearMagnitudeMs,
    windShearMsPerKm: windShearMagnitudeMs / depthGpm * METRES_PER_KILOMETRE,
  };
}

/** Upper-minus-lower potential-temperature gradient per kilometre of geopotential-height difference. */
export function derivePotentialTemperatureGradientKPerKm(
  lowerTemperatureC: number,
  lowerPressureHpa: number,
  upperTemperatureC: number,
  upperPressureHpa: number,
  lowerHeightGpm: number,
  upperHeightGpm: number,
): number {
  const depthGpm = deriveLayerDepthGpm(lowerHeightGpm, upperHeightGpm);
  const lowerThetaK = derivePotentialTemperatureK(lowerTemperatureC, lowerPressureHpa);
  const upperThetaK = derivePotentialTemperatureK(upperTemperatureC, upperPressureHpa);
  return (upperThetaK - lowerThetaK) / depthGpm * METRES_PER_KILOMETRE;
}
