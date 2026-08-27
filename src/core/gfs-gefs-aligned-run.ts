import type { GefsMember } from "../catalog/gefs.js";
import type { GfsGrid } from "../schema/gfs-grid.js";
import { GfsS3RunProbe, type RunAvailabilityProbe } from "../sources/gfs-s3.js";
import { GefsS3RunProbe, type GefsAvailabilityProbe } from "../sources/gefs-s3.js";
import {
  GEFS_MAX_FORECAST_HOUR,
  gefsForecastHour,
  latestGefsCycleAtOrBefore,
  previousGefsCycle,
} from "./gefs-time.js";

export interface GfsGefsAlignedRunProvider {
  resolveLatestAlignedRun(
    validTime: Date,
    variableCode: string,
    pressureLevelHpa: number,
    members: readonly GefsMember[],
    gfsGrid?: GfsGrid,
  ): Promise<Date>;
}

export interface GfsGefsAlignedRunResolverOptions {
  gfsProbe?: RunAvailabilityProbe;
  gefsProbe?: GefsAvailabilityProbe;
  now?: () => Date;
  maxCandidates?: number;
}

export class GfsGefsAlignedRunResolver implements GfsGefsAlignedRunProvider {
  private readonly gfsProbe: RunAvailabilityProbe;
  private readonly gefsProbe: GefsAvailabilityProbe;
  private readonly now: () => Date;
  private readonly maxCandidates: number;

  constructor(options: GfsGefsAlignedRunResolverOptions = {}) {
    this.gfsProbe = options.gfsProbe ?? new GfsS3RunProbe();
    this.gefsProbe = options.gefsProbe ?? new GefsS3RunProbe();
    this.now = options.now ?? (() => new Date());
    this.maxCandidates = options.maxCandidates ?? 16;
  }

  async resolveLatestAlignedRun(
    validTime: Date,
    variableCode: string,
    pressureLevelHpa: number,
    members: readonly GefsMember[],
    gfsGrid: GfsGrid = "0p25",
  ): Promise<Date> {
    const anchorTime = new Date(Math.min(this.now().getTime(), validTime.getTime()));
    const anchor = latestGefsCycleAtOrBefore(anchorTime);

    for (let index = 0; index < this.maxCandidates; index += 1) {
      const run = previousGefsCycle(anchor, index);
      const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
      if (!Number.isInteger(forecastHour) || forecastHour < 0 || forecastHour % 3 !== 0) continue;
      if (forecastHour > GEFS_MAX_FORECAST_HOUR) break;

      const [gfsAvailable, gefsAvailable] = await Promise.all([
        gfsGrid === "0p50"
          ? this.gfsProbe.isForecastAvailable(run, forecastHour, {
              variableCodes: [variableCode],
              pressureLevelsHpa: [pressureLevelHpa],
              fields: [],
            }, gfsGrid)
          : this.gfsProbe.isForecastAvailable(run, forecastHour, {
              variableCodes: [variableCode],
              pressureLevelsHpa: [pressureLevelHpa],
              fields: [],
            }),
        this.gefsProbe.areMembersAvailable(run, forecastHour, members),
      ]);
      if (gfsAvailable && gefsAvailable) return run;
    }

    gefsForecastHour(anchor, validTime);
    throw new Error(
      `No aligned GFS/GEFS cycle in the last ${this.maxCandidates} candidate runs can satisfy the requested valid time, field, pressure level, and member selection`,
    );
  }
}
