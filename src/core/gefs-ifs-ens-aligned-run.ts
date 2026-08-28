import type { GefsMember } from "../catalog/gefs.js";
import { ifsEnsMemberNumber, type IfsEnsMember } from "../catalog/ifs-ens.js";
import type { GefsIfsEnsComparisonVariable } from "../schema/gefs-ifs-ens-comparison.js";
import {
  GefsS3RunProbe,
  type GefsAvailabilityProbe,
} from "../sources/gefs-s3.js";
import {
  IfsEnsOpenDataRunProbe,
  type IfsAvailabilityProbe,
} from "../sources/ifs-open-data.js";
import { gefsForecastHour } from "./gefs-time.js";
import { ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import {
  ifsEnsForecastHour,
  latestIfsCycleAtOrBefore,
  previousIfsCycle,
} from "./ifs-time.js";

export interface GefsIfsEnsAlignedRunProvider {
  resolveLatestAlignedRun(
    validTime: Date,
    variable: GefsIfsEnsComparisonVariable,
    pressureLevelHpa: number,
    gefsMembers: readonly GefsMember[],
    ifsEnsMembers: readonly IfsEnsMember[],
  ): Promise<Date>;
}

export interface GefsIfsEnsAlignedRunResolverOptions {
  gefsProbe?: GefsAvailabilityProbe;
  ifsEnsProbe?: IfsAvailabilityProbe;
  now?: () => Date;
  maxCandidates?: number;
}

export class GefsIfsEnsAlignedRunResolver implements GefsIfsEnsAlignedRunProvider {
  private readonly gefsProbe: GefsAvailabilityProbe;
  private readonly ifsEnsProbe: IfsAvailabilityProbe;
  private readonly now: () => Date;
  private readonly maxCandidates: number;

  constructor(options: GefsIfsEnsAlignedRunResolverOptions = {}) {
    this.gefsProbe = options.gefsProbe ?? new GefsS3RunProbe();
    this.ifsEnsProbe = options.ifsEnsProbe ?? new IfsEnsOpenDataRunProbe();
    this.now = options.now ?? (() => new Date());
    this.maxCandidates = options.maxCandidates ?? 16;
  }

  async resolveLatestAlignedRun(
    validTime: Date,
    variable: GefsIfsEnsComparisonVariable,
    pressureLevelHpa: number,
    gefsMembers: readonly GefsMember[],
    ifsEnsMembers: readonly IfsEnsMember[],
  ): Promise<Date> {
    const baseSelectors = ifsIndexSelectorsForSelection({
      variables: [variable],
      pressureLevelsHpa: [pressureLevelHpa],
    });
    const ifsSelectors = ifsEnsMembers.flatMap((member) =>
      baseSelectors.map((selector) => ({
        ...selector,
        number: ifsEnsMemberNumber(member),
      })),
    );

    const anchorTime = new Date(Math.min(this.now().getTime(), validTime.getTime()));
    const anchor = latestIfsCycleAtOrBefore(anchorTime);

    for (let index = 0; index < this.maxCandidates; index += 1) {
      const run = previousIfsCycle(anchor, index);
      let gefsHour: number;
      let ifsHour: number;
      try {
        gefsHour = gefsForecastHour(run, validTime);
        ifsHour = ifsEnsForecastHour(run, validTime);
      } catch {
        continue;
      }
      if (gefsHour !== ifsHour) continue;

      const [gefsAvailable, ifsAvailable] = await Promise.all([
        this.gefsProbe.areMembersAvailable(run, gefsHour, gefsMembers),
        this.ifsEnsProbe.isForecastAvailable(run, ifsHour, ifsSelectors),
      ]);
      if (gefsAvailable && ifsAvailable) return run;
    }

    throw new Error(
      `No aligned GEFS/IFS ENS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested valid time, pressure selection, and member subsets`,
    );
  }
}
