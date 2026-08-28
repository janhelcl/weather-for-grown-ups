import { homedir } from "node:os";
import { join } from "node:path";
import { FileAccessPolicy, UPSTREAM_ACCESS_POLICIES, withLegacyCooldown } from "../cache/file-access-policy.js";
import {
  historicalAnalysisTimeSchema,
  type HistoricalGfsVariableId,
} from "../schema/history.js";
import type { HistoricalProfileResult } from "../schema/history-result.js";
import {
  archivedGfs025ForecastHourSchema,
  archivedGfsForecastHourSchema,
} from "../schema/history-forecast.js";
import {
  archivedGfsModelId,
  type ArchivedGfsModelId,
  type GfsGrid,
} from "../schema/gfs-grid.js";
import {
  NCEI_GFS_GRID4_FORECAST_START,
  NceiGfsForecastHistorySource,
  type ArchivedGfsForecastDataSource,
} from "../sources/ncei-gfs-forecast-history.js";
import {
  RDA_GFS_0P25_FORECAST_START,
  RdaGfsForecastHistorySource,
} from "../sources/rda-gfs-forecast-history.js";
import type { HistoricalAnalysisDataSource } from "../sources/ncei-gfs-history.js";
import { HistoricalProfileService } from "./history.js";
import type { GridPoint } from "./types.js";

export interface ArchivedGfsForecastProfileQuery {
  runTime: Date;
  grid?: GfsGrid;
  forecastHour: number;
  latitude: number;
  longitude: number;
  variables: readonly HistoricalGfsVariableId[];
  pressureLevelsHpa: readonly number[];
}

export interface ArchivedGfsForecastProfileResult {
  model: ArchivedGfsModelId;
  runTime: string;
  forecastHour: number;
  validTime: string;
  requestedPoint: GridPoint;
  gridPoint: GridPoint;
  selection: {
    variables: readonly HistoricalGfsVariableId[];
    pressureLevelsHpa: readonly number[];
  };
  levels: HistoricalProfileResult["levels"];
  source: {
    provider: "NOAA NCEI" | "NCAR GDEX";
    access: "ncei_thredds_ncss" | "gdex_thredds_ncss";
    dataset: string;
    cacheHit: boolean;
  };
}

export interface ArchivedGfsForecastProfileServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
  source?: ArchivedGfsForecastDataSource;
  rdaSource?: ArchivedGfsForecastDataSource;
  now?: () => Date;
}

export class ArchivedGfsForecastProfileService {
  private readonly nceiSource: ArchivedGfsForecastDataSource;
  private readonly rdaSource: ArchivedGfsForecastDataSource;
  private readonly now: () => Date;

  constructor(options: ArchivedGfsForecastProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const nceiAccessPolicy = new FileAccessPolicy(
      join(cacheDir, "state"),
      withLegacyCooldown(UPSTREAM_ACCESS_POLICIES.nceiThredds, options.cooldownMs),
    );
    const gdexAccessPolicy = new FileAccessPolicy(
      join(cacheDir, "state"),
      withLegacyCooldown(UPSTREAM_ACCESS_POLICIES.gdex, options.cooldownMs),
    );
    this.nceiSource = options.source ?? new NceiGfsForecastHistorySource({
      cacheDir: join(cacheDir, "ncei-forecast-history"),
      limiter: nceiAccessPolicy,
    });
    this.rdaSource = options.rdaSource ?? new RdaGfsForecastHistorySource({
      cacheDir: join(cacheDir, "rda-forecast-history"),
      limiter: gdexAccessPolicy,
    });
    this.now = options.now ?? (() => new Date());
  }

  async getArchivedForecastProfile(query: ArchivedGfsForecastProfileQuery): Promise<ArchivedGfsForecastProfileResult> {
    historicalAnalysisTimeSchema.parse(query.runTime.toISOString());
    const grid = query.grid ?? "0p50";
    const forecastHour = grid === "0p50"
      ? archivedGfsForecastHourSchema.parse(query.forecastHour)
      : archivedGfs025ForecastHourSchema.parse(query.forecastHour);
    const minimumTime = grid === "0p50"
      ? NCEI_GFS_GRID4_FORECAST_START
      : RDA_GFS_0P25_FORECAST_START;
    if (query.runTime < minimumTime) {
      throw new Error(
        `GFS ${grid} forecast history begins at ${minimumTime.toISOString()} for this archive`,
      );
    }
    const source = grid === "0p50" ? this.nceiSource : this.rdaSource;

    const validTime = new Date(query.runTime.getTime() + forecastHour * 60 * 60 * 1_000);
    if (validTime > this.now()) throw new Error("Archived GFS forecast validTime must not be in the future");

    const adapter: HistoricalAnalysisDataSource = {
      fetch: async (request) => source.fetch({
        runTime: query.runTime,
        forecastHour,
        latitude: request.latitude,
        longitude: request.longitude,
        variables: request.variables,
      }),
    };
    const normalizer = new HistoricalProfileService({
      source: adapter,
      now: this.now,
      allowNonAnalysisCycle: true,
      minimumTime,
      nativeSpecificHumidity: grid === "0p25",
    });
    const profile = await normalizer.getHistoricalProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      analysisTime: validTime.toISOString(),
      variables: [...query.variables],
      pressureLevelsHpa: [...query.pressureLevelsHpa],
    });

    return {
      model: archivedGfsModelId(grid),
      runTime: query.runTime.toISOString(),
      forecastHour,
      validTime: validTime.toISOString(),
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      selection: {
        variables: [...query.variables],
        pressureLevelsHpa: [...query.pressureLevelsHpa],
      },
      levels: profile.levels,
      source: {
        provider: grid === "0p50" ? "NOAA NCEI" : "NCAR GDEX",
        access: grid === "0p50" ? "ncei_thredds_ncss" : "gdex_thredds_ncss",
        dataset: profile.source.dataset,
        cacheHit: profile.source.cacheHit,
      },
    };
  }
}
