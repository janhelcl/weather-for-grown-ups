import type { GefsPgrb2aFieldId } from "./gefs-fields.js";
import type { GefsMember } from "./gefs.js";
import type { VariableId } from "../schema/query.js";

export const GEFS_REFORECAST_STANDARD_MEMBERS = [
  "c00", "p01", "p02", "p03", "p04",
] as const satisfies readonly GefsMember[];

export const GEFS_REFORECAST_EXTENDED_MEMBERS = [
  ...GEFS_REFORECAST_STANDARD_MEMBERS,
  "p05", "p06", "p07", "p08", "p09", "p10",
] as const satisfies readonly GefsMember[];

export type GefsReforecastMember = (typeof GEFS_REFORECAST_EXTENDED_MEMBERS)[number];

export const GEFS_REFORECAST_FIELD_IDS = [
  "surface_pressure",
  "temperature_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
  "total_precipitation",
  "precipitable_water",
  "total_atmosphere_cloud_cover",
  "mean_sea_level_pressure",
] as const satisfies readonly GefsPgrb2aFieldId[];

export type GefsReforecastFieldId = (typeof GEFS_REFORECAST_FIELD_IDS)[number];

export const GEFS_REFORECAST_PRESSURE_VARIABLE_IDS = [
  "temperature",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "vertical_velocity",
  "specific_humidity",
] as const satisfies readonly VariableId[];

export type GefsReforecastPressureVariableId =
  (typeof GEFS_REFORECAST_PRESSURE_VARIABLE_IDS)[number];

export const GEFS_REFORECAST_PRESSURE_LEVELS_HPA = [
  1, 2, 3, 5, 10, 20, 30, 50, 70, 100, 150, 200, 250,
  300, 400, 500, 600, 700, 800, 850, 900, 925, 950, 975, 1000,
] as const;

export const GEFS_REFORECAST_SPECIFIC_HUMIDITY_LEVELS_HPA = [
  100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 850,
  900, 925, 950, 975, 1000,
] as const;

const PRESSURE_LEVEL_SET = new Set<number>(GEFS_REFORECAST_PRESSURE_LEVELS_HPA);
const SPECIFIC_HUMIDITY_LEVEL_SET =
  new Set<number>(GEFS_REFORECAST_SPECIFIC_HUMIDITY_LEVELS_HPA);

export function isGefsReforecastFieldId(value: string): value is GefsReforecastFieldId {
  return (GEFS_REFORECAST_FIELD_IDS as readonly string[]).includes(value);
}

export function isGefsReforecastPressureVariableId(
  value: string,
): value is GefsReforecastPressureVariableId {
  return (GEFS_REFORECAST_PRESSURE_VARIABLE_IDS as readonly string[]).includes(value);
}

export function isSupportedGefsReforecastPressureSelection(
  variable: GefsReforecastPressureVariableId,
  pressureLevelHpa: number,
): boolean {
  if (!PRESSURE_LEVEL_SET.has(pressureLevelHpa)) return false;
  return variable !== "specific_humidity"
    || SPECIFIC_HUMIDITY_LEVEL_SET.has(pressureLevelHpa);
}
