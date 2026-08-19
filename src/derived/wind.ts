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
