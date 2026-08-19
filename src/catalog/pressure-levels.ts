export const GFS_PRESSURE_LEVELS_HPA = Object.freeze([
  1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350,
  300, 250, 200, 150, 100, 70, 50, 40, 30, 20, 15, 10, 7, 5, 3, 2, 1, 0.7, 0.4, 0.2,
  0.1, 0.07, 0.04, 0.02, 0.01,
] as const);

const PRESSURE_LEVEL_SET = new Set<number>(GFS_PRESSURE_LEVELS_HPA);

export function isSupportedGfsPressureLevel(value: number): boolean {
  return PRESSURE_LEVEL_SET.has(value);
}
