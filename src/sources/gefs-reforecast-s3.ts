import type {
  GefsReforecastFieldId,
  GefsReforecastMember,
  GefsReforecastPressureVariableId,
} from "../catalog/gefs-reforecast.js";

export const GEFS_REFORECAST_S3_BASE_URL = "https://noaa-gefs-retrospective.s3.amazonaws.com";
export const GEFS_REFORECAST_START_YEAR = 2000;
export const GEFS_REFORECAST_END_YEAR = 2019;
export const GEFS_REFORECAST_MAX_FORECAST_HOUR = 384;

export type GefsReforecastLeadBlock = "Days:1-10" | "Days:10-16";
export type GefsReforecastPressureFileGroup = "base" | "above_700mb";
export type GefsReforecastProfileGridPolicy =
  | "native_0p25"
  | "native_0p50"
  | "coherent_0p50";

const REFORECAST_FILE_STEMS: Record<
  Exclude<GefsReforecastFieldId, "wind_10m">,
  string
> = {
  surface_pressure: "pres_sfc",
  temperature_2m: "tmp_2m",
  u_wind_10m: "ugrd_hgt",
  v_wind_10m: "vgrd_hgt",
  total_precipitation: "apcp_sfc",
  precipitable_water: "pwat_eatm",
  total_atmosphere_cloud_cover: "tcdc_eatm",
  mean_sea_level_pressure: "pres_msl",
};

const REFORECAST_PRESSURE_FILE_STEMS: Record<GefsReforecastPressureVariableId, string> = {
  temperature: "tmp_pres",
  u_wind: "ugrd_pres",
  v_wind: "vgrd_pres",
  geopotential_height: "hgt_pres",
  vertical_velocity: "vvel_pres",
  specific_humidity: "spfh_pres",
};

export function parseGefsReforecastRun(value: string): Date {
  const run = new Date(value);
  if (Number.isNaN(run.getTime())) throw new Error(`Invalid GEFSv12 reforecast run: ${value}`);
  if (
    run.getUTCHours() !== 0
    || run.getUTCMinutes() !== 0
    || run.getUTCSeconds() !== 0
    || run.getUTCMilliseconds() !== 0
  ) {
    throw new Error("GEFSv12 reforecasts are initialized once daily at 00Z");
  }
  const year = run.getUTCFullYear();
  if (year < GEFS_REFORECAST_START_YEAR || year > GEFS_REFORECAST_END_YEAR) {
    throw new Error(
      `GEFSv12 public reforecast runs must be within ${GEFS_REFORECAST_START_YEAR}-${GEFS_REFORECAST_END_YEAR}`,
    );
  }
  return run;
}

export function gefsReforecastForecastHour(run: Date, validTime: Date): number {
  const hours = (validTime.getTime() - run.getTime()) / 3_600_000;
  if (!Number.isInteger(hours) || hours < 3) {
    throw new Error("GEFSv12 reforecast validTime must be a whole forecast hour at least +3 h after the run");
  }
  if (hours > GEFS_REFORECAST_MAX_FORECAST_HOUR) {
    throw new Error(
      `GEFSv12 standard public reforecast access currently supports lead times through +${GEFS_REFORECAST_MAX_FORECAST_HOUR} h`,
    );
  }
  if (hours <= 240 ? hours % 3 !== 0 : hours % 6 !== 0) {
    throw new Error(
      hours <= 240
        ? "GEFSv12 reforecast output is available every 3 hours through +240 h"
        : "GEFSv12 reforecast output is available every 6 hours after +240 h",
    );
  }
  return hours;
}

export function gefsReforecastLeadBlock(forecastHour: number): GefsReforecastLeadBlock {
  if (!Number.isInteger(forecastHour) || forecastHour < 3 || forecastHour > GEFS_REFORECAST_MAX_FORECAST_HOUR) {
    throw new Error(`Invalid GEFSv12 reforecast forecast hour: ${forecastHour}`);
  }
  return forecastHour <= 240 ? "Days:1-10" : "Days:10-16";
}

export function gefsReforecastHorizontalGridDegrees(forecastHour: number): 0.25 | 0.5 {
  return forecastHour <= 240 ? 0.25 : 0.5;
}

export function gefsReforecastPressureFileGroup(
  forecastHour: number,
  pressureLevelHpa: number,
): GefsReforecastPressureFileGroup {
  gefsReforecastLeadBlock(forecastHour);
  if (!(pressureLevelHpa > 0) || !Number.isFinite(pressureLevelHpa)) {
    throw new Error(`Invalid GEFSv12 reforecast pressure level: ${pressureLevelHpa}`);
  }
  return forecastHour <= 240 && pressureLevelHpa < 700 ? "above_700mb" : "base";
}

export function gefsReforecastProfileGrid(
  forecastHour: number,
  pressureLevelsHpa: readonly number[],
): { horizontalGridDegrees: 0.25 | 0.5; profileGridPolicy: GefsReforecastProfileGridPolicy } {
  gefsReforecastLeadBlock(forecastHour);
  if (pressureLevelsHpa.length === 0) {
    throw new Error("GEFSv12 reforecast profile requires at least one pressure level");
  }
  if (forecastHour > 240) {
    return { horizontalGridDegrees: 0.5, profileGridPolicy: "native_0p50" };
  }
  const hasUpperAir = pressureLevelsHpa.some((level) => level < 700);
  const hasLowerAir = pressureLevelsHpa.some((level) => level >= 700);
  if (hasUpperAir && hasLowerAir) {
    return { horizontalGridDegrees: 0.5, profileGridPolicy: "coherent_0p50" };
  }
  return hasUpperAir
    ? { horizontalGridDegrees: 0.5, profileGridPolicy: "native_0p50" }
    : { horizontalGridDegrees: 0.25, profileGridPolicy: "native_0p25" };
}

export function buildGefsReforecastFieldUrl(
  run: Date,
  member: GefsReforecastMember,
  forecastHour: number,
  field: Exclude<GefsReforecastFieldId, "wind_10m">,
): string {
  const cycle = yyyymmddhh(run);
  const year = run.getUTCFullYear();
  const block = encodeURIComponent(gefsReforecastLeadBlock(forecastHour));
  const stem = REFORECAST_FILE_STEMS[field];
  return `${GEFS_REFORECAST_S3_BASE_URL}/GEFSv12/reforecast/${year}/${cycle}/${member}/${block}/${stem}_${cycle}_${member}.grib2`;
}

export function buildGefsReforecastFieldIndexUrl(
  run: Date,
  member: GefsReforecastMember,
  forecastHour: number,
  field: Exclude<GefsReforecastFieldId, "wind_10m">,
): string {
  return `${buildGefsReforecastFieldUrl(run, member, forecastHour, field)}.idx`;
}

export function buildGefsReforecastPressureUrl(
  run: Date,
  member: GefsReforecastMember,
  forecastHour: number,
  variable: GefsReforecastPressureVariableId,
  fileGroup: GefsReforecastPressureFileGroup,
): string {
  if (forecastHour > 240 && fileGroup === "above_700mb") {
    throw new Error("GEFSv12 reforecast pressure data after +240 h is stored in the base variable file");
  }
  const cycle = yyyymmddhh(run);
  const year = run.getUTCFullYear();
  const block = encodeURIComponent(gefsReforecastLeadBlock(forecastHour));
  const suffix = fileGroup === "above_700mb" ? "_abv700mb" : "";
  const stem = REFORECAST_PRESSURE_FILE_STEMS[variable];
  return `${GEFS_REFORECAST_S3_BASE_URL}/GEFSv12/reforecast/${year}/${cycle}/${member}/${block}/${stem}${suffix}_${cycle}_${member}.grib2`;
}

export function buildGefsReforecastPressureIndexUrl(
  run: Date,
  member: GefsReforecastMember,
  forecastHour: number,
  variable: GefsReforecastPressureVariableId,
  fileGroup: GefsReforecastPressureFileGroup,
): string {
  return `${buildGefsReforecastPressureUrl(run, member, forecastHour, variable, fileGroup)}.idx`;
}

function yyyymmddhh(date: Date): string {
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
    date.getUTCHours().toString().padStart(2, "0"),
  ].join("");
}
