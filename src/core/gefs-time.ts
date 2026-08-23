const GEFS_RUN_HOURS = new Set([0, 6, 12, 18]);
const HOUR_MS = 3_600_000;
export const GEFS_MAX_FORECAST_HOUR = 384;
export const GEFS_FORECAST_STEP_HOURS = 3;

export function parseGefsRun(value: string): Date {
  const run = new Date(value);
  if (Number.isNaN(run.getTime())) throw new Error(`Invalid GEFS run: ${value}`);
  if (
    !GEFS_RUN_HOURS.has(run.getUTCHours()) ||
    run.getUTCMinutes() !== 0 ||
    run.getUTCSeconds() !== 0 ||
    run.getUTCMilliseconds() !== 0
  ) {
    throw new Error("GEFS run must be initialized at 00Z, 06Z, 12Z, or 18Z");
  }
  return run;
}

export function gefsForecastHour(run: Date, validTime: Date): number {
  const hours = (validTime.getTime() - run.getTime()) / HOUR_MS;
  if (!Number.isInteger(hours) || hours < 0) {
    throw new Error("GEFS validTime must be a whole forecast hour at or after run time");
  }
  if (hours > GEFS_MAX_FORECAST_HOUR) {
    throw new Error(`GEFS forecast hour must be <= ${GEFS_MAX_FORECAST_HOUR} in the current WFG ensemble contract`);
  }
  if (hours % GEFS_FORECAST_STEP_HOURS !== 0) {
    throw new Error("GEFS 0.5° pgrb2a output is available every 3 hours");
  }
  return hours;
}

export function latestGefsCycleAtOrBefore(value: Date): Date {
  const hour = Math.floor(value.getUTCHours() / 6) * 6;
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
    hour,
  ));
}

export function previousGefsCycle(run: Date, cycles = 1): Date {
  if (!Number.isInteger(cycles) || cycles < 0) throw new Error("cycles must be a non-negative integer");
  return new Date(run.getTime() - cycles * 6 * HOUR_MS);
}
