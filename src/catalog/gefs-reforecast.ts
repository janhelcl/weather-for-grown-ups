import type { GefsPgrb2aFieldId } from "./gefs-fields.js";
import type { GefsMember } from "./gefs.js";

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

export function isGefsReforecastFieldId(value: string): value is GefsReforecastFieldId {
  return (GEFS_REFORECAST_FIELD_IDS as readonly string[]).includes(value);
}
