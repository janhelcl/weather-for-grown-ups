export interface Wind {
  speedMs: number;
  directionDeg: number;
}

export function deriveWind(uMs: number, vMs: number): Wind {
  const speedMs = Math.hypot(uMs, vMs);
  const directionDeg = (Math.atan2(-uMs, -vMs) * 180) / Math.PI;
  return {
    speedMs,
    directionDeg: (directionDeg + 360) % 360,
  };
}

/**
 * Shortest signed angular change from one meteorological direction to another,
 * in [-180, 180). 350° → 10° is +20°, not -340°.
 */
export function circularDegreeDelta(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}
