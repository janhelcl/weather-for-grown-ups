export const AIFS_MAX_FORECAST_HOUR = 360;
export const AIFS_FORECAST_INTERVAL_HOURS = 6;
const HOUR_MS = 3_600_000;

export const AIFS_NATIVE_FORECAST_HOURS = Object.freeze(
  Array.from(
    { length: AIFS_MAX_FORECAST_HOUR / AIFS_FORECAST_INTERVAL_HOURS + 1 },
    (_, index) => index * AIFS_FORECAST_INTERVAL_HOURS,
  ),
);

export function parseAifsRun(value: string): Date {
  const run = new Date(value);
  if (!Number.isFinite(run.getTime())) throw new Error(`Invalid AIFS run: ${value}`);
  if (
    run.getUTCMinutes() !== 0
    || run.getUTCSeconds() !== 0
    || run.getUTCMilliseconds() !== 0
    || ![0, 6, 12, 18].includes(run.getUTCHours())
  ) {
    throw new Error("AIFS run must be an exact 00/06/12/18 UTC initialization cycle");
  }
  return run;
}

export function aifsForecastHour(run: Date, validTime: Date): number {
  const forecastHour = (validTime.getTime() - run.getTime()) / HOUR_MS;
  if (!Number.isInteger(forecastHour) || forecastHour < 0) {
    throw new Error("AIFS valid time must be at or after the run on an integer forecast hour");
  }
  if (!isNativeAifsForecastHour(forecastHour)) {
    throw new Error(
      `AIFS run ${run.toISOString()} does not publish f${forecastHour}; native cadence is 6-hourly through f${AIFS_MAX_FORECAST_HOUR}`,
    );
  }
  return forecastHour;
}

export function isNativeAifsForecastHour(forecastHour: number): boolean {
  return Number.isInteger(forecastHour)
    && forecastHour >= 0
    && forecastHour <= AIFS_MAX_FORECAST_HOUR
    && forecastHour % AIFS_FORECAST_INTERVAL_HOURS === 0;
}

export function aifsForecastHoursInRange(
  run: Date,
  startTime: Date,
  endTime: Date,
): number[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new Error("AIFS end time must be at or after start time");
  }
  const firstHour = Math.ceil((startTime.getTime() - run.getTime()) / HOUR_MS);
  const lastHour = Math.floor((endTime.getTime() - run.getTime()) / HOUR_MS);
  const result = AIFS_NATIVE_FORECAST_HOURS.filter(
    (hour) => hour >= Math.max(0, firstHour) && hour <= lastHour,
  );
  if (result.length === 0) {
    throw new Error("Requested AIFS time range contains no native forecast outputs for the selected run");
  }
  return [...result];
}

export function aifsValidTime(run: Date, forecastHour: number): Date {
  if (!isNativeAifsForecastHour(forecastHour)) {
    throw new Error(`AIFS f${forecastHour} is not a native forecast output`);
  }
  return new Date(run.getTime() + forecastHour * HOUR_MS);
}

export function latestAifsCycleAtOrBefore(time: Date): Date {
  const date = new Date(time);
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(Math.floor(date.getUTCHours() / 6) * 6);
  return date;
}

export function previousAifsCycle(anchor: Date, cyclesBack = 1): Date {
  return new Date(anchor.getTime() - cyclesBack * 6 * HOUR_MS);
}
