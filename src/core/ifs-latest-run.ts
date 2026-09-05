import { DataUnavailableError } from "../failure.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { IfsOpenDataAccessPolicy } from "../access/ifs-open-data.js";
import {
  IfsOpenDataRunProbe,
  type IfsAvailabilityProbe,
  type IfsIndexSelector,
} from "../sources/ifs-open-data.js";
import {
  ifsForecastHour,
  ifsForecastHoursInRange,
  ifsMaxForecastHour,
  isNativeIfsForecastHour,
  latestIfsCycleAtOrBefore,
  previousIfsCycle,
} from "./ifs-time.js";

const HOUR_MS = 3_600_000;

export interface IfsLatestRunProvider {
  resolveLatestRun(
    validTime: Date,
    selectors: readonly IfsIndexSelector[],
  ): Promise<Date>;
}

export interface IfsLatestRangeRunProvider {
  resolveLatestRunForRange(
    startTime: Date,
    endTime: Date,
    selectors: readonly IfsIndexSelector[],
  ): Promise<Date>;
}

export interface IfsLatestRunResolverOptions {
  probe?: IfsAvailabilityProbe;
  now?: () => Date;
  maxCandidates?: number;
  cacheDir?: string;
}

export class IfsLatestRunResolver implements IfsLatestRunProvider {
  private readonly probe: IfsAvailabilityProbe;
  private readonly now: () => Date;
  private readonly maxCandidates: number;

  constructor(options: IfsLatestRunResolverOptions = {}) {
    if (options.probe !== undefined) {
      this.probe = options.probe;
    } else {
      const cacheDir = options.cacheDir
        ?? process.env.WFG_CACHE_DIR
        ?? join(homedir(), ".cache", "wfg");
      this.probe = new IfsOpenDataRunProbe(
        globalThis.fetch,
        new IfsOpenDataAccessPolicy(join(cacheDir, "ifs-open-data", "access-state")),
      );
    }
    this.now = options.now ?? (() => new Date());
    this.maxCandidates = options.maxCandidates ?? 12;
  }

  async resolveLatestRunForRange(
    startTime: Date,
    endTime: Date,
    selectors: readonly IfsIndexSelector[],
  ): Promise<Date> {
    if (endTime.getTime() < startTime.getTime()) {
      throw new Error("IFS end time must be at or after start time");
    }
    const anchorTime = new Date(Math.min(this.now().getTime(), endTime.getTime()));
    const anchor = latestIfsCycleAtOrBefore(anchorTime);

    for (let index = 0; index < this.maxCandidates; index += 1) {
      const run = previousIfsCycle(anchor, index);
      if (run.getTime() > startTime.getTime()) continue;
      const maxValidTime = run.getTime() + ifsMaxForecastHour(run) * HOUR_MS;
      if (maxValidTime < endTime.getTime()) continue;

      let forecastHours: number[];
      try {
        forecastHours = ifsForecastHoursInRange(run, startTime, endTime);
      } catch {
        continue;
      }
      const lastForecastHour = forecastHours[forecastHours.length - 1];
      if (lastForecastHour === undefined) continue;
      if (await selectionAvailable(this.probe, run, lastForecastHour, selectors)) return run;
    }

    throw new DataUnavailableError(
      `No published ECMWF IFS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested time range and field selection`,
    );
  }

  async resolveLatestRun(
    validTime: Date,
    selectors: readonly IfsIndexSelector[],
  ): Promise<Date> {
    const anchorTime = new Date(Math.min(this.now().getTime(), validTime.getTime()));
    const anchor = latestIfsCycleAtOrBefore(anchorTime);

    for (let index = 0; index < this.maxCandidates; index += 1) {
      const run = previousIfsCycle(anchor, index);
      const forecastHour = rawForecastHour(run, validTime);
      if (!isNativeIfsForecastHour(run, forecastHour)) continue;
      if (await selectionAvailable(this.probe, run, forecastHour, selectors)) return run;
    }

    // Preserve explicit cadence errors when possible before reporting publication failure.
    ifsForecastHour(anchor, validTime);
    throw new DataUnavailableError(
      `No published ECMWF IFS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested valid time and field selection`,
    );
  }
}

async function selectionAvailable(
  probe: IfsAvailabilityProbe,
  run: Date,
  requestedForecastHour: number,
  selectors: readonly IfsIndexSelector[],
): Promise<boolean> {
  const groups = new Map<number, IfsIndexSelector[]>();
  for (const selector of selectors) {
    const sourceForecastHour = selector.sourceForecastHour ?? requestedForecastHour;
    const group = groups.get(sourceForecastHour) ?? [];
    group.push(selector);
    groups.set(sourceForecastHour, group);
  }
  for (const [sourceForecastHour, group] of groups) {
    if (!await probe.isForecastAvailable(run, sourceForecastHour, group)) return false;
  }
  return true;
}

function rawForecastHour(run: Date, validTime: Date): number {
  return (validTime.getTime() - run.getTime()) / HOUR_MS;
}
