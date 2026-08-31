export const AIGFS_MAX_FORECAST_HOUR = 384;
export const AIGFS_FORECAST_INTERVAL_HOURS = 6;
export const AIGFS_NATIVE_FORECAST_HOURS = Object.freeze(
  Array.from(
    { length: AIGFS_MAX_FORECAST_HOUR / AIGFS_FORECAST_INTERVAL_HOURS + 1 },
    (_, index) => index * AIGFS_FORECAST_INTERVAL_HOURS,
  ),
);

export type AigfsProduct = "pres" | "sfc";
export type AigefsStatistic = "avg" | "spr";

export interface AigfsNomadsPathResolver {
  label: string;
  buildUrl(run: Date, forecastHour: number, product: AigfsProduct): string;
  buildIndexUrl(run: Date, forecastHour: number, product: AigfsProduct): string;
}

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

export const AIGFS_NOMADS_PATHS: AigfsNomadsPathResolver = {
  label: "AIGFS",
  buildUrl: buildAigfsNomadsUrl,
  buildIndexUrl: buildAigfsNomadsIndexUrl,
};

export function buildAigefsNomadsUrl(
  run: Date,
  forecastHour: number,
  member: string,
  product: AigfsProduct,
): string {
  assertAigfsForecastHour(forecastHour);
  if (!/^\\d{3}$/.test(member) || Number(member) < 0 || Number(member) > 30) {
    throw new Error(`Invalid AIGEFS member ${member}; expected 000 through 030`);
  }
  const date = [
    run.getUTCFullYear(),
    String(run.getUTCMonth() + 1).padStart(2, "0"),
    String(run.getUTCDate()).padStart(2, "0"),
  ].join("");
  const cycle = String(run.getUTCHours()).padStart(2, "0");
  const hour = String(forecastHour).padStart(3, "0");
  return [
    "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigefs/prod",
    `aigefs.${date}`,
    cycle,
    `mem${member}/model/atmos/grib2`,
    `aigefs.t${cycle}z.${product}.f${hour}.grib2`,
  ].join("/");
}

export function buildAigefsNomadsIndexUrl(
  run: Date,
  forecastHour: number,
  member: string,
  product: AigfsProduct,
): string {
  return `${buildAigefsNomadsUrl(run, forecastHour, member, product)}.idx`;
}

export function aigefsMemberNomadsPaths(member: string): AigfsNomadsPathResolver {
  return {
    label: `AIGEFS member ${member}`,
    buildUrl: (run, forecastHour, product) =>
      buildAigefsNomadsUrl(run, forecastHour, member, product),
    buildIndexUrl: (run, forecastHour, product) =>
      buildAigefsNomadsIndexUrl(run, forecastHour, member, product),
  };
}

export function buildAigefsStatisticNomadsUrl(
  run: Date,
  forecastHour: number,
  statistic: AigefsStatistic,
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
    "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigefs/prod",
    `aigefs.${date}`,
    cycle,
    "ensstat/products/atmos/grib2",
    `aigefs.t${cycle}z.${product}.${statistic}.f${hour}.grib2`,
  ].join("/");
}

export function aigefsStatisticNomadsPaths(
  statistic: AigefsStatistic = "avg",
): AigfsNomadsPathResolver {
  return {
    label: `AIGEFS ensemble ${statistic}`,
    buildUrl: (run, forecastHour, product) =>
      buildAigefsStatisticNomadsUrl(run, forecastHour, statistic, product),
    buildIndexUrl: (run, forecastHour, product) =>
      `${buildAigefsStatisticNomadsUrl(run, forecastHour, statistic, product)}.idx`,
  };
}

export function parseAigfsRun(value: string): Date {
  const run = new Date(value);
  if (Number.isNaN(run.getTime())) throw new Error(`Invalid AIGFS run: ${value}`);
  if (
    run.getUTCHours() % 6 !== 0
    || run.getUTCMinutes() !== 0
    || run.getUTCSeconds() !== 0
    || run.getUTCMilliseconds() !== 0
  ) {
    throw new Error("AIGFS run must be initialized at 00Z, 06Z, 12Z, or 18Z");
  }
  return run;
}

export function aigfsForecastHour(run: Date, validTime: Date): number {
  const hours = (validTime.getTime() - run.getTime()) / 3_600_000;
  if (!Number.isInteger(hours) || hours < 0) {
    throw new Error("AIGFS validTime must be a whole forecast hour at or after run time");
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
    throw new Error("endTime must be at or after startTime");
  }
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const hours = AIGFS_NATIVE_FORECAST_HOURS.filter((forecastHour) => {
    const validMs = run.getTime() + forecastHour * 3_600_000;
    return validMs >= startMs && validMs <= endMs;
  });
  if (hours.length === 0) {
    throw new Error("No native AIGFS forecast outputs fall inside the requested time range");
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
    throw new Error(`AIGFS forecast hour must be a whole number from 0 to ${AIGFS_MAX_FORECAST_HOUR}`);
  }
  if (forecastHour % AIGFS_FORECAST_INTERVAL_HOURS !== 0) {
    throw new Error("AIGFS output is available every 6 forecast hours");
  }
}
