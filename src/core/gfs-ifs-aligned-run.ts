import { expandRequestedVariables } from "../catalog/variables.js";
import type { IfsPressureVariableId } from "../catalog/ifs.js";
import type { GfsGrid } from "../schema/gfs-grid.js";
import { GfsS3RunProbe, type RunAvailabilityProbe } from "../sources/gfs-s3.js";
import {
  IfsOpenDataRunProbe,
  type IfsAvailabilityProbe,
} from "../sources/ifs-open-data.js";
import { forecastHour } from "./forecast-hour.js";
import { ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import {
  ifsForecastHour,
  latestIfsCycleAtOrBefore,
  previousIfsCycle,
} from "./ifs-time.js";

export interface GfsIfsAlignedRunProvider {
  resolveLatestAlignedRun(
    validTime: Date,
    variable: IfsPressureVariableId,
    pressureLevelHpa: number,
    gfsGrid?: GfsGrid,
  ): Promise<Date>;
}

export interface GfsIfsAlignedRunResolverOptions {
  gfsProbe?: RunAvailabilityProbe;
  ifsProbe?: IfsAvailabilityProbe;
  now?: () => Date;
  maxCandidates?: number;
}

export class GfsIfsAlignedRunResolver implements GfsIfsAlignedRunProvider {
  private readonly gfsProbe: RunAvailabilityProbe;
  private readonly ifsProbe: IfsAvailabilityProbe;
  private readonly now: () => Date;
  private readonly maxCandidates: number;

  constructor(options: GfsIfsAlignedRunResolverOptions = {}) {
    this.gfsProbe = options.gfsProbe ?? new GfsS3RunProbe();
    this.ifsProbe = options.ifsProbe ?? new IfsOpenDataRunProbe();
    this.now = options.now ?? (() => new Date());
    this.maxCandidates = options.maxCandidates ?? 12;
  }

  async resolveLatestAlignedRun(
    validTime: Date,
    variable: IfsPressureVariableId,
    pressureLevelHpa: number,
    gfsGrid: GfsGrid = "0p25",
  ): Promise<Date> {
    const rawVariables = expandRequestedVariables([variable]);
    const gfsSelection = {
      variableCodes: rawVariables.map((definition) => definition.gfsCode),
      pressureLevelsHpa: [pressureLevelHpa],
      fields: [],
    };
    const ifsSelectors = ifsIndexSelectorsForSelection({
      variables: [variable],
      pressureLevelsHpa: [pressureLevelHpa],
    });

    const anchorTime = new Date(Math.min(this.now().getTime(), validTime.getTime()));
    const anchor = latestIfsCycleAtOrBefore(anchorTime);

    for (let index = 0; index < this.maxCandidates; index += 1) {
      const run = previousIfsCycle(anchor, index);
      let gfsForecastHour: number;
      let ifsForecastHourValue: number;
      try {
        gfsForecastHour = forecastHour(run, validTime, gfsGrid);
        ifsForecastHourValue = ifsForecastHour(run, validTime);
      } catch {
        continue;
      }

      const [gfsAvailable, ifsAvailable] = await Promise.all([
        this.gfsProbe.isForecastAvailable(run, gfsForecastHour, gfsSelection, gfsGrid),
        this.ifsProbe.isForecastAvailable(run, ifsForecastHourValue, ifsSelectors),
      ]);
      if (gfsAvailable && ifsAvailable) return run;
    }

    throw new Error(
      `No aligned GFS/IFS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested valid time, variable, pressure level, and GFS grid`,
    );
  }
}
