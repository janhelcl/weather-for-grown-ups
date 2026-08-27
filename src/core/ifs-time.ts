export const IFS_LONG_RUN_MAX_FORECAST_HOUR = 360;
export const IFS_SHORT_RUN_MAX_FORECAST_HOUR = 144;

const HOUR_MS = 3_600_000;

export function parseIfsRun(value: string): Date {
  const run = new Date(value);
  if (!Number.isFinite(run.getTime())) throw new Error(`Invalid IFS run: ${value}`);
  if (
    run.getUTCMinutes() !== 0
    || run.getUTCSeconds() !== 0
    || run.getUTCMilliseconds() !== 0
    || ![0, 6, 12, 18].includes(run.getUTCHours())
  ) {
    throw new Error("IFS run must be an exact 00/06/12/18 UTC initialization cycle");
  }
  return run;
}

export function ifsForecastHour(run: Date, validTime: Date): number {
  const forecastHour = (validTime.getTime() - run.getTime()) / HOUR_MS;
  if (!Number.isInteger(forecastHour) || forecastHour < 0) {
    throw new Error("IFS valid time must be at or after the run on an integer forecast hour");
  }
  if (!isNativeIfsForecastHour(run, forecastHour)) {
    const max = ifsMaxForecastHour(run);
    const cadence = isLongIfsRun(run)
      ? "3-hourly through f144 then 6-hourly from f150 through f360"
      : "3-hourly through f144";
    throw new Error(
      `IFS run ${run.toISOString()} does not publish f${forecastHour}; native cadence is ${cadence} (max f${max})`,
    );
  }
  return forecastHour;
}

export function ifsMaxForecastHour(run: Date): number {
  return isLongIfsRun(run) ? IFS_LONG_RUN_MAX_FORECAST_HOUR : IFS_SHORT_RUN_MAX_FORECAST_HOUR;
}

export function isNativeIfsForecastHour(run: Date, forecastHour: number): boolean {
  if (!Number.isInteger(forecastHour) || forecastHour < 0) return false;
  if (!isLongIfsRun(run)) return forecastHour <= IFS_SHORT_RUN_MAX_FORECAST_HOUR && forecastHour % 3 === 0;
  if (forecastHour <= 144) return forecastHour % 3 === 0;
  return forecastHour >= 150
    && forecastHour <= IFS_LONG_RUN_MAX_FORECAST_HOUR
    && forecastHour % 6 === 0;
}

export function ifsForecastHoursInRange(
  run: Date,
  startTime: Date,
  endTime: Date,
): number[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new Error("IFS end time must be at or after start time");
  }
  const firstHour = Math.ceil((startTime.getTime() - run.getTime()) / HOUR_MS);
  const lastHour = Math.floor((endTime.getTime() - run.getTime()) / HOUR_MS);
  const result: number[] = [];
  for (let forecastHour = Math.max(0, firstHour); forecastHour <= lastHour; forecastHour += 1) {
    if (isNativeIfsForecastHour(run, forecastHour)) result.push(forecastHour);
  }
  if (result.length === 0) {
    throw new Error("Requested IFS time range contains no native forecast outputs for the selected run");
  }
  return result;
}

export function ifsValidTimeForForecastHour(run: Date, forecastHour: number): Date {
  if (!isNativeIfsForecastHour(run, forecastHour)) {
    throw new Error(`IFS f${forecastHour} is not native for run ${run.toISOString()}`);
  }
  return new Date(run.getTime() + forecastHour * HOUR_MS);
}

export function latestIfsCycleAtOrBefore(time: Date): Date {
  const date = new Date(time);
  date.setUTCMinutes(0, 0, 0);
  const hour = date.getUTCHours();
  const cycle = hour >= 18 ? 18 : hour >= 12 ? 12 : hour >= 6 ? 6 : 0;
  date.setUTCHours(cycle);
  return date;
}

export function previousIfsCycle(anchor: Date, cyclesBack = 1): Date {
  return new Date(anchor.getTime() - cyclesBack * 6 * HOUR_MS);
}

export function isLongIfsRun(run: Date): boolean {
  const hour = run.getUTCHours();
  return hour === 0 || hour === 12;
}
