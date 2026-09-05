import { InvalidRequestError } from "../failure.js";
export const AIGFS_MAX_FORECAST_HOUR = 384;
export const AIGFS_FORECAST_INTERVAL_HOURS = 6;
export const AIGFS_NATIVE_FORECAST_HOURS = Object.freeze(
  Array.from(
    { length: AIGFS_MAX_FORECAST_HOUR / AIGFS_FORECAST_INTERVAL_HOURS + 1 },
    (_, index) => index * AIGFS_FORECAST_INTERVAL_HOURS,
  ),
);

export type AigfsProduct = "pres" | "sfc";

export function buildAigfsNomadsUrl(
  run: Date,
  forecastHour: number,
  product: AigfsProduct,
): string {
  assertAigfsForecastHour(forecastHour);
  const date = [
    run.getUTCFullYear(),
    String(run.getUTCMonth() + 1).padStart(2, "0"),
    String(run.getUTCDate()).padStart(2, "0"),
  ].join("");
  const cycle = String(run.getUTCHours()).padStart(2, "0");
  const hour = String(forecastHour).padStart(3, "0");
  return [
    "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod",
    `aigfs.${date}`,
    cycle,
    "model/atmos/grib2",
    `aigfs.t${cycle}z.${product}.f${hour}.grib2`,
  ].join("/");
}

export function buildAigfsNomadsIndexUrl(
  run: Date,
  forecastHour: number,
  product: AigfsProduct,
): string {
  return `${buildAigfsNomadsUrl(run, forecastHour, product)}.idx`;
}

export function parseAigfsRun(value: string): Date {
  const run = new Date(value);
  if (Number.isNaN(run.getTime())) throw new InvalidRequestError(`Invalid AIGFS run: ${value}`);
  if (
    run.getUTCHours() % 6 !== 0
    || run.getUTCMinutes() !== 0
    || run.getUTCSeconds() !== 0
    || run.getUTCMilliseconds() !== 0
  ) {
    throw new InvalidRequestError("AIGFS run must be initialized at 00Z, 06Z, 12Z, or 18Z");
  }
  return run;
}

export function aigfsForecastHour(run: Date, validTime: Date): number {
  const hours = (validTime.getTime() - run.getTime()) / 3_600_000;
  if (!Number.isInteger(hours) || hours < 0) {
    throw new InvalidRequestError("AIGFS/AIGEFS validTime must be a whole forecast hour at or after run time");
  }
  assertAigfsForecastHour(hours);
  return hours;
}

export function aigfsNativeForecastHoursInRange(
  run: Date,
  startTime: Date,
  endTime: Date,
): number[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new InvalidRequestError("endTime must be at or after startTime");
  }
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const hours = AIGFS_NATIVE_FORECAST_HOURS.filter((forecastHour) => {
    const validMs = run.getTime() + forecastHour * 3_600_000;
    return validMs >= startMs && validMs <= endMs;
  });
  if (hours.length === 0) {
    throw new InvalidRequestError("No native AIGFS forecast outputs fall inside the requested time range");
  }
  return [...hours];
}

export function aigfsValidTime(run: Date, forecastHour: number): Date {
  assertAigfsForecastHour(forecastHour);
  return new Date(run.getTime() + forecastHour * 3_600_000);
}

export function floorToAigfsCycle(value: Date): Date {
  const result = new Date(value.getTime());
  result.setUTCHours(Math.floor(result.getUTCHours() / 6) * 6, 0, 0, 0);
  return result;
}

function assertAigfsForecastHour(forecastHour: number): void {
  if (!Number.isInteger(forecastHour) || forecastHour < 0 || forecastHour > AIGFS_MAX_FORECAST_HOUR) {
    throw new InvalidRequestError(`AIGFS/AIGEFS forecast hour must be a whole number from 0 to ${AIGFS_MAX_FORECAST_HOUR}`);
  }
  if (forecastHour % AIGFS_FORECAST_INTERVAL_HOURS !== 0) {
    throw new InvalidRequestError("AIGFS/AIGEFS output is available every 6 forecast hours");
  }
}
