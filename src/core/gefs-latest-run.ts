import type { GefsMember } from "../catalog/gefs.js";
import { GefsS3RunProbe, type GefsAvailabilityProbe } from "../sources/gefs-s3.js";
import {
  GEFS_MAX_FORECAST_HOUR,
  gefsForecastHour,
  latestGefsCycleAtOrBefore,
  previousGefsCycle,
} from "./gefs-time.js";

export interface GefsLatestRunProvider {
  resolveLatestRun(validTime: Date, members: readonly GefsMember[]): Promise<Date>;
}

export interface GefsLatestRunResolverOptions {
  probe?: GefsAvailabilityProbe;
  now?: () => Date;
  maxCandidates?: number;
}

export class GefsLatestRunResolver implements GefsLatestRunProvider {
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
      const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
      if (!Number.isInteger(forecastHour) || forecastHour < 0 || forecastHour % 3 !== 0) continue;
      if (forecastHour > GEFS_MAX_FORECAST_HOUR) break;
      if (await this.probe.areMembersAvailable(run, forecastHour, members)) return run;
    }

    // Produce the same explicit cadence/range errors callers get for an explicit run where possible.
    gefsForecastHour(anchor, validTime);
    throw new Error(
      `No published GEFS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested valid time and member selection`,
    );
  }
}
