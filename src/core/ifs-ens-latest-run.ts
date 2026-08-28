import {
  IfsEnsOpenDataRunProbe,
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

export interface IfsEnsLatestRunProvider {
  resolveLatestRun(
    validTime: Date,
    selectors: readonly IfsIndexSelector[],
  ): Promise<Date>;
}

export interface IfsEnsLatestRunResolverOptions {
  probe?: IfsAvailabilityProbe;
  now?: () => Date;
  maxCandidates?: number;
}

export class IfsEnsLatestRunResolver implements IfsEnsLatestRunProvider {
  private readonly probe: IfsAvailabilityProbe;
  private readonly now: () => Date;
  private readonly maxCandidates: number;

  constructor(options: IfsEnsLatestRunResolverOptions = {}) {
    this.probe = options.probe ?? new IfsEnsOpenDataRunProbe();
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
      const forecastHour = (validTime.getTime() - run.getTime()) / HOUR_MS;
      if (!isNativeIfsForecastHour(run, forecastHour)) continue;
      if (await selectionAvailable(this.probe, run, forecastHour, selectors)) return run;
    }

    ifsForecastHour(anchor, validTime);
    throw new Error(
      `No published ECMWF IFS ENS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested valid time, perturbations, and field selection`,
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
