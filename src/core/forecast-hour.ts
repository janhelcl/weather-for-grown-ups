const GFS_RUN_HOURS = new Set([0, 6, 12, 18]);
const HOUR_MS = 3_600_000;
export const GFS_MAX_FORECAST_HOUR = 384;
export const GFS_HOURLY_THROUGH_FORECAST_HOUR = 120;
export const GFS_NATIVE_FORECAST_HOURS = Object.freeze([
  ...Array.from({ length: GFS_HOURLY_THROUGH_FORECAST_HOUR + 1 }, (_, hour) => hour),
  ...Array.from(
    { length: (GFS_MAX_FORECAST_HOUR - 123) / 3 + 1 },
    (_, index) => 123 + index * 3,
  ),
]);

export function parseGfsRun(value: string): Date {
  const run = new Date(value);
  if (Number.isNaN(run.getTime())) throw new Error(`Invalid GFS run: ${value}`);

  if (
    !GFS_RUN_HOURS.has(run.getUTCHours()) ||
    run.getUTCMinutes() !== 0 ||
    run.getUTCSeconds() !== 0 ||
    run.getUTCMilliseconds() !== 0
  ) {
    throw new Error("GFS run must be initialized at 00Z, 06Z, 12Z, or 18Z");
  }

  return run;
}

export function forecastHour(run: Date, validTime: Date): number {
  const hours = (validTime.getTime() - run.getTime()) / HOUR_MS;
  if (!Number.isInteger(hours) || hours < 0) {
    throw new Error("validTime must be a whole forecast hour at or after run time");
  }
  if (hours > GFS_MAX_FORECAST_HOUR) throw new Error(`GFS forecast hour must be <= ${GFS_MAX_FORECAST_HOUR}`);
  if (hours > GFS_HOURLY_THROUGH_FORECAST_HOUR && hours % 3 !== 0) {
    throw new Error("After forecast hour 120, GFS 0.25° output is available every 3 hours");
  }
  return hours;
}

export function nativeForecastHoursInRange(run: Date, startTime: Date, endTime: Date): number[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new Error("endTime must be at or after startTime");
  }

  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const hours = GFS_NATIVE_FORECAST_HOURS.filter((forecastHourValue) => {
    const validMs = run.getTime() + forecastHourValue * HOUR_MS;
    return validMs >= startMs && validMs <= endMs;
  });

  if (hours.length === 0) {
    throw new Error("No native GFS forecast outputs fall inside the requested time range");
  }
  return [...hours];
}

export function validTimeForForecastHour(run: Date, forecastHourValue: number): Date {
  return new Date(run.getTime() + forecastHourValue * HOUR_MS);
}
