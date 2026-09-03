import {
  GEFS_FORECAST_STEP_HOURS,
  GEFS_MAX_FORECAST_HOUR,
  GEFS_TOTAL_NATIVE_FORECAST_STEPS,
} from "../catalog/gefs.js";
export {
  GEFS_FORECAST_STEP_HOURS,
  GEFS_MAX_FORECAST_HOUR,
  GEFS_TOTAL_NATIVE_FORECAST_STEPS,
} from "../catalog/gefs.js";

const GEFS_RUN_HOURS = new Set([0, 6, 12, 18]);
const HOUR_MS = 3_600_000;
const THREE_HOURS_MS = 3 * HOUR_MS;

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

export function nativeGefsValidTimesInRange(startTime: Date, endTime: Date, maxSteps: number): Date[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new Error("GEFS time-series endTime must be at or after startTime");
  }
  if (!isNativeGefsValidTime(startTime) || !isNativeGefsValidTime(endTime)) {
    throw new Error("GEFS time-series bounds must be exact native three-hour valid times");
  }
  const span = endTime.getTime() - startTime.getTime();
  if (span % THREE_HOURS_MS !== 0) {
    throw new Error("GEFS time-series range must align to the native three-hour cadence");
  }
  const count = span / THREE_HOURS_MS + 1;
  if (count > maxSteps) {
    throw new Error(`GEFS time series would contain ${count} steps, exceeding maxSteps=${maxSteps}`);
  }
  return Array.from({ length: count }, (_, index) => new Date(startTime.getTime() + index * THREE_HOURS_MS));
}

export function isNativeGefsValidTime(value: Date): boolean {
  return value.getUTCMinutes() === 0
    && value.getUTCSeconds() === 0
    && value.getUTCMilliseconds() === 0
    && value.getUTCHours() % GEFS_FORECAST_STEP_HOURS === 0;
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
