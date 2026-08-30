import { ifsEnsMemberNumber, type IfsEnsMember } from "../catalog/ifs-ens.js";
import type { IfsIfsEnsComparisonVariable } from "../schema/ifs-ifs-ens-comparison.js";
import {
  IfsEnsOpenDataRunProbe,
  IfsOpenDataRunProbe,
  type IfsAvailabilityProbe,
} from "../sources/ifs-open-data.js";
import { ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import {
  ifsEnsForecastHour,
  ifsForecastHour,
  latestIfsCycleAtOrBefore,
  previousIfsCycle,
} from "./ifs-time.js";

export interface IfsIfsEnsAlignedRunProvider {
  resolveLatestAlignedRun(
    validTime: Date,
    variable: IfsIfsEnsComparisonVariable,
    pressureLevelHpa: number,
    members: readonly IfsEnsMember[],
  ): Promise<Date>;
}

export interface IfsIfsEnsAlignedRunResolverOptions {
  ifsProbe?: IfsAvailabilityProbe;
  ifsEnsProbe?: IfsAvailabilityProbe;
  now?: () => Date;
  maxCandidates?: number;
}

export class IfsIfsEnsAlignedRunResolver implements IfsIfsEnsAlignedRunProvider {
  private readonly ifsProbe: IfsAvailabilityProbe;
  private readonly ifsEnsProbe: IfsAvailabilityProbe;
  private readonly now: () => Date;
  private readonly maxCandidates: number;

  constructor(options: IfsIfsEnsAlignedRunResolverOptions = {}) {
    this.ifsProbe = options.ifsProbe ?? new IfsOpenDataRunProbe();
    this.ifsEnsProbe = options.ifsEnsProbe ?? new IfsEnsOpenDataRunProbe();
    this.now = options.now ?? (() => new Date());
    this.maxCandidates = options.maxCandidates ?? 12;
  }

  async resolveLatestAlignedRun(
    validTime: Date,
    variable: IfsIfsEnsComparisonVariable,
    pressureLevelHpa: number,
    members: readonly IfsEnsMember[],
  ): Promise<Date> {
    const deterministicSelectors = ifsIndexSelectorsForSelection({
      variables: [variable],
      pressureLevelsHpa: [pressureLevelHpa],
    });
    const ensembleSelectors = members.flatMap((member) =>
      deterministicSelectors.map((selector) => ({
        ...selector,
        number: ifsEnsMemberNumber(member),
      })),
    );

    const anchorTime = new Date(Math.min(this.now().getTime(), validTime.getTime()));
    const anchor = latestIfsCycleAtOrBefore(anchorTime);

    for (let index = 0; index < this.maxCandidates; index += 1) {
      const run = previousIfsCycle(anchor, index);
      let deterministicHour: number;
      let ensembleHour: number;
      try {
        deterministicHour = ifsForecastHour(run, validTime);
        ensembleHour = ifsEnsForecastHour(run, validTime);
      } catch {
        continue;
      }
      if (deterministicHour !== ensembleHour) {
        throw new Error("IFS and IFS ENS forecast-hour helpers disagreed for the same cycle");
      }

      const [ifsAvailable, ifsEnsAvailable] = await Promise.all([
        this.ifsProbe.isForecastAvailable(run, deterministicHour, deterministicSelectors),
        this.ifsEnsProbe.isForecastAvailable(run, ensembleHour, ensembleSelectors),
      ]);
      if (ifsAvailable && ifsEnsAvailable) return run;
    }

    throw new Error(
      `No aligned deterministic IFS/IFS ENS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested valid time, pressure selection, and perturbation subset`,
    );
  }
}
