import {
  IfsOpenDataRunProbe,
  type IfsAvailabilityProbe,
  type IfsIndexSelector,
} from "../sources/ifs-open-data.js";
import {
  ifsForecastHour,
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

export interface IfsLatestRunResolverOptions {
  probe?: IfsAvailabilityProbe;
  now?: () => Date;
  maxCandidates?: number;
}

export class IfsLatestRunResolver implements IfsLatestRunProvider {
  private readonly probe: IfsAvailabilityProbe;
  private readonly now: () => Date;
  private readonly maxCandidates: number;

  constructor(options: IfsLatestRunResolverOptions = {}) {
    this.probe = options.probe ?? new IfsOpenDataRunProbe();
    this.now = options.now ?? (() => new Date());
    this.maxCandidates = options.maxCandidates ?? 12;
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
      if (await this.probe.isForecastAvailable(run, forecastHour, selectors)) return run;
    }

    // Preserve explicit cadence errors when possible before reporting publication failure.
    ifsForecastHour(anchor, validTime);
    throw new Error(
      `No published ECMWF IFS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested valid time and field selection`,
    );
  }
}

function rawForecastHour(run: Date, validTime: Date): number {
  return (validTime.getTime() - run.getTime()) / HOUR_MS;
}
