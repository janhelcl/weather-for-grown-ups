import { DataUnavailableError } from "../failure.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { IfsOpenDataAccessPolicy } from "../access/ifs-open-data.js";
import {
  AifsOpenDataRunProbe,
  type AifsAvailabilityProbe,
} from "../sources/aifs-open-data.js";
import type { IfsIndexSelector } from "../sources/ifs-open-data.js";
import {
  AIFS_MAX_FORECAST_HOUR,
  aifsForecastHour,
  aifsForecastHoursInRange,
  latestAifsCycleAtOrBefore,
  previousAifsCycle,
} from "./aifs-time.js";

const HOUR_MS = 3_600_000;

export interface AifsLatestRunProvider {
  resolveLatestRun(validTime: Date, selectors: readonly IfsIndexSelector[]): Promise<Date>;
  resolveLatestRunForRange(
    startTime: Date,
    endTime: Date,
    selectors: readonly IfsIndexSelector[],
  ): Promise<Date>;
}

export interface AifsLatestRunResolverOptions {
  probe?: AifsAvailabilityProbe;
  now?: () => Date;
  maxCandidates?: number;
  cacheDir?: string;
}

export class AifsLatestRunResolver implements AifsLatestRunProvider {
  private readonly probe: AifsAvailabilityProbe;
  private readonly now: () => Date;
  private readonly maxCandidates: number;

  constructor(options: AifsLatestRunResolverOptions = {}) {
    if (options.probe !== undefined) {
      this.probe = options.probe;
    } else {
      const cacheDir = options.cacheDir
        ?? process.env.WFG_CACHE_DIR
        ?? join(homedir(), ".cache", "wfg");
      this.probe = new AifsOpenDataRunProbe(
        globalThis.fetch,
        new IfsOpenDataAccessPolicy(join(cacheDir, "aifs-open-data", "access-state")),
      );
    }
    this.now = options.now ?? (() => new Date());
    this.maxCandidates = options.maxCandidates ?? 16;
  }

  async resolveLatestRun(
    validTime: Date,
    selectors: readonly IfsIndexSelector[],
  ): Promise<Date> {
    const anchorTime = new Date(Math.min(this.now().getTime(), validTime.getTime()));
    const anchor = latestAifsCycleAtOrBefore(anchorTime);

    for (let index = 0; index < this.maxCandidates; index += 1) {
      const run = previousAifsCycle(anchor, index);
      try {
        const forecastHour = aifsForecastHour(run, validTime);
        if (await this.probe.isForecastAvailable(run, forecastHour, selectors)) return run;
      } catch {
        continue;
      }
    }

    throw new DataUnavailableError(
      `No published ECMWF AIFS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested valid time and field selection`,
    );
  }

  async resolveLatestRunForRange(
    startTime: Date,
    endTime: Date,
    selectors: readonly IfsIndexSelector[],
  ): Promise<Date> {
    if (endTime.getTime() < startTime.getTime()) {
      throw new Error("AIFS end time must be at or after start time");
    }
    const anchorTime = new Date(Math.min(this.now().getTime(), endTime.getTime()));
    const anchor = latestAifsCycleAtOrBefore(anchorTime);

    for (let index = 0; index < this.maxCandidates; index += 1) {
      const run = previousAifsCycle(anchor, index);
      if (run.getTime() > startTime.getTime()) continue;
      if (run.getTime() + AIFS_MAX_FORECAST_HOUR * HOUR_MS < endTime.getTime()) continue;

      let hours: number[];
      try {
        hours = aifsForecastHoursInRange(run, startTime, endTime);
      } catch {
        continue;
      }
      const lastForecastHour = hours.at(-1);
      if (
        lastForecastHour !== undefined
        && await this.probe.isForecastAvailable(run, lastForecastHour, selectors)
      ) {
        return run;
      }
    }

    throw new DataUnavailableError(
      `No published ECMWF AIFS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested time range and field selection`,
    );
  }
}
