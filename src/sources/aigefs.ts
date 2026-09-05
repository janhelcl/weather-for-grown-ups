import { InvalidRequestError } from "../failure.js";
import { aigefsSourceMember, type AigefsMember } from "../catalog/aigefs.js";
import {
  AIGFS_FORECAST_INTERVAL_HOURS,
  AIGFS_MAX_FORECAST_HOUR,
} from "./aigfs.js";

export const AIGEFS_MAX_FORECAST_HOUR = AIGFS_MAX_FORECAST_HOUR;
export const AIGEFS_FORECAST_INTERVAL_HOURS = AIGFS_FORECAST_INTERVAL_HOURS;
export const AIGEFS_S3_BASE_URL =
  "https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com/EAGLE_ensemble";

export type AigefsProduct = "pres" | "sfc";

export function buildAigefsS3Url(
  run: Date,
  forecastHour: number,
  member: AigefsMember,
  product: AigefsProduct,
): string {
  assertAigefsForecastHour(forecastHour);
  const date = [
    run.getUTCFullYear(),
    String(run.getUTCMonth() + 1).padStart(2, "0"),
    String(run.getUTCDate()).padStart(2, "0"),
  ].join("");
  const cycle = String(run.getUTCHours()).padStart(2, "0");
  const hour = String(forecastHour).padStart(3, "0");
  return [
    AIGEFS_S3_BASE_URL,
    `aigefs.${date}`,
    cycle,
    aigefsSourceMember(member),
    "model/atmos/grib2",
    `aigefs.t${cycle}z.${product}.f${hour}.grib2`,
  ].join("/");
}

export function buildAigefsS3IndexUrl(
  run: Date,
  forecastHour: number,
  member: AigefsMember,
  product: AigefsProduct,
): string {
  return `${buildAigefsS3Url(run, forecastHour, member, product)}.idx`;
}

function assertAigefsForecastHour(forecastHour: number): void {
  if (
    !Number.isInteger(forecastHour)
    || forecastHour < 0
    || forecastHour > AIGEFS_MAX_FORECAST_HOUR
  ) {
    throw new InvalidRequestError(
      `AIGEFS forecast hour must be a whole number from 0 to ${AIGEFS_MAX_FORECAST_HOUR}`,
    );
  }
  if (forecastHour % AIGEFS_FORECAST_INTERVAL_HOURS !== 0) {
    throw new InvalidRequestError("AIGEFS output is available every 6 forecast hours");
  }
}
