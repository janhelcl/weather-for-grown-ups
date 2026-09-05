import { InvalidRequestError } from "../failure.js";
export const ICON_D2_MAX_FORECAST_HOUR = 48;
export const ICON_D2_FORECAST_INTERVAL_HOURS = 1;
export const ICON_D2_NATIVE_FORECAST_HOURS = Object.freeze(
  Array.from(
    { length: ICON_D2_MAX_FORECAST_HOUR + 1 },
    (_, index) => index,
  ),
);

export type IconD2OpenDataProduct =
  | { type: "pressure"; parameter: string; pressureHpa: number }
  | { type: "single"; parameter: string };

export function buildIconD2OpenDataUrl(
  run: Date,
  forecastHour: number,
  product: IconD2OpenDataProduct,
): string {
  assertIconD2Run(run);
  assertIconD2ForecastHour(forecastHour);
  const cycle = String(run.getUTCHours()).padStart(2, "0");
  const stamp = [
    run.getUTCFullYear(),
    String(run.getUTCMonth() + 1).padStart(2, "0"),
    String(run.getUTCDate()).padStart(2, "0"),
    cycle,
  ].join("");
  const lead = String(forecastHour).padStart(3, "0");
  const parameter = product.parameter.toLowerCase();
  const descriptor = product.type === "pressure"
    ? `pressure-level_${stamp}_${lead}_${product.pressureHpa}_${parameter}`
    : `single-level_${stamp}_${lead}_2d_${parameter}`;
  return [
    "https://opendata.dwd.de/weather/nwp/icon-d2/grib",
    cycle,
    parameter,
    `icon-d2_germany_regular-lat-lon_${descriptor}.grib2.bz2`,
  ].join("/");
}

export function parseIconD2Run(value: string): Date {
  const run = new Date(value);
  if (Number.isNaN(run.getTime())) throw new InvalidRequestError(`Invalid ICON-D2 run: ${value}`);
  assertIconD2Run(run);
  return run;
}

export function iconD2ForecastHour(run: Date, validTime: Date): number {
  const hours = (validTime.getTime() - run.getTime()) / 3_600_000;
  if (!Number.isInteger(hours) || hours < 0) {
    throw new InvalidRequestError("ICON-D2 validTime must be a whole forecast hour at or after run time");
  }
  assertIconD2ForecastHour(hours);
  return hours;
}

export function iconD2NativeForecastHoursInRange(
  run: Date,
  startTime: Date,
  endTime: Date,
): number[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new Error("endTime must be at or after startTime");
  }
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const hours = ICON_D2_NATIVE_FORECAST_HOURS.filter((forecastHour) => {
    const validMs = run.getTime() + forecastHour * 3_600_000;
    return validMs >= startMs && validMs <= endMs;
  });
  if (hours.length === 0) {
    throw new Error("No native ICON-D2 forecast outputs fall inside the requested time range");
  }
  return [...hours];
}

export function iconD2ValidTime(run: Date, forecastHour: number): Date {
  assertIconD2ForecastHour(forecastHour);
  return new Date(run.getTime() + forecastHour * 3_600_000);
}

export function floorToIconD2Cycle(value: Date): Date {
  const result = new Date(value.getTime());
  result.setUTCHours(Math.floor(result.getUTCHours() / 3) * 3, 0, 0, 0);
  return result;
}

function assertIconD2Run(run: Date): void {
  if (
    run.getUTCHours() % 3 !== 0
    || run.getUTCMinutes() !== 0
    || run.getUTCSeconds() !== 0
    || run.getUTCMilliseconds() !== 0
  ) {
    throw new InvalidRequestError("ICON-D2 run must be initialized at a 3-hourly UTC cycle (00Z, 03Z, ..., 21Z)");
  }
}

function assertIconD2ForecastHour(forecastHour: number): void {
  if (
    !Number.isInteger(forecastHour)
    || forecastHour < 0
    || forecastHour > ICON_D2_MAX_FORECAST_HOUR
  ) {
    throw new InvalidRequestError(
      `ICON-D2 forecast hour must be a whole number from 0 to ${ICON_D2_MAX_FORECAST_HOUR}`,
    );
  }
}
