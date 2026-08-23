import type { GefsMember } from "../catalog/gefs.js";
import { GefsS3RunProbe, type GefsAvailabilityProbe } from "../sources/gefs-s3.js";
import {
  GEFS_MAX_FORECAST_HOUR,
  gefsForecastHour,
  latestGefsCycleAtOrBefore,
  previousGefsCycle,
} from "./gefs-time.js";

const HOUR_MS = 3_600_000;

export interface GefsLatestRunProvider {
  resolveLatestRun(validTime: Date, members: readonly GefsMember[]): Promise<Date>;
}

export interface GefsLatestRunRangeProvider {
  resolveLatestRunRange(
    startTime: Date,
    endTime: Date,
    members: readonly GefsMember[],
  ): Promise<Date>;
}

export interface GefsLatestRunResolverOptions {
  probe?: GefsAvailabilityProbe;
  now?: () => Date;
  maxCandidates?: number;
}

export class GefsLatestRunResolver implements GefsLatestRunProvider, GefsLatestRunRangeProvider {
  private readonly probe: GefsAvailabilityProbe;
  private readonly now: () => Date;
  private readonly maxCandidates: number;

  constructor(options: GefsLatestRunResolverOptions = {}) {
    this.probe = options.probe ?? new GefsS3RunProbe();
    this.now = options.now ?? (() => new Date());
    this.maxCandidates = options.maxCandidates ?? 16;
  }

  async resolveLatestRun(validTime: Date, members: readonly GefsMember[]): Promise<Date> {
    const anchorTime = new Date(Math.min(this.now().getTime(), validTime.getTime()));
    const anchor = latestGefsCycleAtOrBefore(anchorTime);

    for (let index = 0; index < this.maxCandidates; index += 1) {
      const run = previousGefsCycle(anchor, index);
      const forecastHour = rawForecastHour(run, validTime);
      if (!isCandidateForecastHour(forecastHour)) continue;
      if (forecastHour > GEFS_MAX_FORECAST_HOUR) break;
      if (await this.probe.areMembersAvailable(run, forecastHour, members)) return run;
    }

    // Produce the same explicit cadence/range errors callers get for an explicit run where possible.
    gefsForecastHour(anchor, validTime);
    throw new Error(
      `No published GEFS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested valid time and member selection`,
    );
  }

  async resolveLatestRunRange(
    startTime: Date,
    endTime: Date,
    members: readonly GefsMember[],
  ): Promise<Date> {
    if (endTime.getTime() < startTime.getTime()) {
      throw new Error("GEFS ensemble time-series endTime must be at or after startTime");
    }

    // A range must use one cycle that predates its first valid time. For a future range,
    // do not consider model cycles that have not initialized yet.
    const anchorTime = new Date(Math.min(this.now().getTime(), startTime.getTime()));
    const anchor = latestGefsCycleAtOrBefore(anchorTime);

    for (let index = 0; index < this.maxCandidates; index += 1) {
      const run = previousGefsCycle(anchor, index);
      const startForecastHour = rawForecastHour(run, startTime);
      const endForecastHour = rawForecastHour(run, endTime);
      if (!isCandidateForecastHour(startForecastHour) || !isCandidateForecastHour(endForecastHour)) continue;
      if (endForecastHour > GEFS_MAX_FORECAST_HOUR) break;

      const startAvailable = await this.probe.areMembersAvailable(run, startForecastHour, members);
      if (!startAvailable) continue;
      if (startForecastHour === endForecastHour) return run;

      const endAvailable = await this.probe.areMembersAvailable(run, endForecastHour, members);
      if (endAvailable) return run;
    }

    // Preserve the same explicit cadence/range validation as a reproducible explicit run.
    gefsForecastHour(anchor, startTime);
    gefsForecastHour(anchor, endTime);
    throw new Error(
      `No published GEFS cycle in the last ${this.maxCandidates} candidate runs can satisfy the complete requested time range and member selection`,
    );
  }
}

function rawForecastHour(run: Date, validTime: Date): number {
  return (validTime.getTime() - run.getTime()) / HOUR_MS;
}

function isCandidateForecastHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value % 3 === 0;
}
