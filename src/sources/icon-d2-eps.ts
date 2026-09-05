import { InvalidRequestError } from "../failure.js";
import {
  ICON_D2_FORECAST_INTERVAL_HOURS,
  ICON_D2_MAX_FORECAST_HOUR,
  ICON_D2_NATIVE_FORECAST_HOURS,
  floorToIconD2Cycle,
  iconD2ForecastHour,
  iconD2NativeForecastHoursInRange,
  iconD2ValidTime,
  parseIconD2Run,
  type IconD2OpenDataProduct,
} from "./icon-d2.js";

export const ICON_D2_EPS_MAX_FORECAST_HOUR = ICON_D2_MAX_FORECAST_HOUR;
export const ICON_D2_EPS_FORECAST_INTERVAL_HOURS = ICON_D2_FORECAST_INTERVAL_HOURS;
export const ICON_D2_EPS_NATIVE_FORECAST_HOURS = ICON_D2_NATIVE_FORECAST_HOURS;
export type IconD2EpsOpenDataProduct = IconD2OpenDataProduct;

export function buildIconD2EpsOpenDataUrl(
  run: Date,
  forecastHour: number,
  product: IconD2EpsOpenDataProduct,
): string {
  parseIconD2Run(run.toISOString());
  if (
    !Number.isInteger(forecastHour)
    || forecastHour < 0
    || forecastHour > ICON_D2_EPS_MAX_FORECAST_HOUR
  ) {
    throw new InvalidRequestError(
      `ICON-D2-EPS forecast hour must be a whole number from 0 to ${ICON_D2_EPS_MAX_FORECAST_HOUR}`,
    );
  }

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
    "https://opendata.dwd.de/weather/nwp/icon-d2-eps/grib",
    cycle,
    parameter,
    `icon-d2-eps_germany_icosahedral_${descriptor}.grib2.bz2`,
  ].join("/");
}

export {
  floorToIconD2Cycle as floorToIconD2EpsCycle,
  iconD2ForecastHour as iconD2EpsForecastHour,
  iconD2NativeForecastHoursInRange as iconD2EpsNativeForecastHoursInRange,
  iconD2ValidTime as iconD2EpsValidTime,
  parseIconD2Run as parseIconD2EpsRun,
};
