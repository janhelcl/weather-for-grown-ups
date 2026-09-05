import { InvalidRequestError } from "../failure.js";
export const AROME_0P01_MAX_FORECAST_HOUR = 51;
export const AROME_0P01_FORECAST_INTERVAL_HOURS = 1;
export const AROME_0P01_NATIVE_FORECAST_HOURS = Object.freeze(
  Array.from({ length: AROME_0P01_MAX_FORECAST_HOUR + 1 }, (_, index) => index),
);

export type Arome0p01Package = "SP1" | "HP1" | "SP2";

export function buildArome0p01OpenDataUrl(
  run: Date,
  forecastHour: number,
  packageId: Arome0p01Package,
): string {
  assertAromeRun(run);
  assertAromeForecastHour(forecastHour);
  const runStamp = run.toISOString().replace(".000Z", "Z");
  const lead = String(forecastHour).padStart(2, "0");
  return [
    "https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/pnt",
    runStamp,
    "arome",
    "001",
    packageId,
    `arome__001__${packageId}__${lead}H__${runStamp}.grib2`,
  ].join("/");
}

export function parseAromeRun(value: string): Date {
  const run = new Date(value);
  if (Number.isNaN(run.getTime())) throw new InvalidRequestError(`Invalid AROME run: ${value}`);
  assertAromeRun(run);
  return run;
}

export function aromeForecastHour(run: Date, validTime: Date): number {
  const hours = (validTime.getTime() - run.getTime()) / 3_600_000;
  if (!Number.isInteger(hours) || hours < 0) {
    throw new InvalidRequestError("AROME validTime must be a whole forecast hour at or after run time");
  }
  assertAromeForecastHour(hours);
  return hours;
}

export function aromeNativeForecastHoursInRange(
  run: Date,
  startTime: Date,
  endTime: Date,
): number[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new Error("endTime must be at or after startTime");
  }
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const hours = AROME_0P01_NATIVE_FORECAST_HOURS.filter((forecastHour) => {
    const validMs = run.getTime() + forecastHour * 3_600_000;
    return validMs >= startMs && validMs <= endMs;
  });
  if (hours.length === 0) {
    throw new Error("No native AROME forecast outputs fall inside the requested time range");
  }
  return [...hours];
}

export function aromeValidTime(run: Date, forecastHour: number): Date {
  assertAromeForecastHour(forecastHour);
  return new Date(run.getTime() + forecastHour * 3_600_000);
}

export function floorToAromeCycle(value: Date): Date {
  const result = new Date(value.getTime());
  result.setUTCHours(Math.floor(result.getUTCHours() / 3) * 3, 0, 0, 0);
  return result;
}

function assertAromeRun(run: Date): void {
  if (
    run.getUTCHours() % 3 !== 0
    || run.getUTCMinutes() !== 0
    || run.getUTCSeconds() !== 0
    || run.getUTCMilliseconds() !== 0
  ) {
    throw new InvalidRequestError("AROME run must be initialized at a 3-hourly UTC cycle (00Z, 03Z, ..., 21Z)");
  }
}

function assertAromeForecastHour(forecastHour: number): void {
  if (
    !Number.isInteger(forecastHour)
    || forecastHour < 0
    || forecastHour > AROME_0P01_MAX_FORECAST_HOUR
  ) {
    throw new InvalidRequestError(
      `AROME forecast hour must be a whole number from 0 to ${AROME_0P01_MAX_FORECAST_HOUR}`,
    );
  }
}
