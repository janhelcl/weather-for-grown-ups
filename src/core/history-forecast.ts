import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import {
  historicalAnalysisTimeSchema,
  type HistoricalGfsVariableId,
} from "../schema/history.js";
import {
  historicalVerificationLeadHoursSchema,
} from "../schema/history-verification.js";
import {
  NCEI_GFS_GRID4_FORECAST_START,
  NceiGfsForecastHistorySource,
  type ArchivedGfsForecastDataSource,
} from "../sources/ncei-gfs-forecast-history.js";
import type { HistoricalAnalysisDataSource } from "../sources/ncei-gfs-history.js";
import { HistoricalProfileService } from "./history.js";
import type { GridPoint, ProfileLevel } from "./types.js";

export interface ArchivedGfsForecastProfileQuery {
  runTime: Date;
  forecastHour: number;
  latitude: number;
  longitude: number;
  variables: readonly HistoricalGfsVariableId[];
  pressureLevelsHpa: readonly number[];
}

export interface ArchivedGfsForecastProfileResult {
  model: "gfs_grid4_forecast_0p5_archive";
  runTime: string;
  forecastHour: number;
  validTime: string;
  requestedPoint: GridPoint;
  gridPoint: GridPoint;
  levels: ProfileLevel[];
  source: {
    provider: "NOAA NCEI";
    access: "ncei_thredds_ncss";
    dataset: string;
    cacheHit: boolean;
  };
}

export interface ArchivedGfsForecastProfileServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
  source?: ArchivedGfsForecastDataSource;
  now?: () => Date;
}

export class ArchivedGfsForecastProfileService {
  private readonly source: ArchivedGfsForecastDataSource;
  private readonly now: () => Date;

  constructor(options: ArchivedGfsForecastProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const limiter = new FileRateLimiter(
      join(cacheDir, "state"),
      options.cooldownMs ?? DEFAULT_NOMADS_COOLDOWN_MS,
    );
    this.source = options.source ?? new NceiGfsForecastHistorySource({
      cacheDir: join(cacheDir, "ncei-forecast-history"),
      limiter,
    });
    this.now = options.now ?? (() => new Date());
  }

  async getArchivedForecastProfile(query: ArchivedGfsForecastProfileQuery): Promise<ArchivedGfsForecastProfileResult> {
    historicalAnalysisTimeSchema.parse(query.runTime.toISOString());
    const forecastHour = historicalVerificationLeadHoursSchema.parse(query.forecastHour);
    if (query.runTime < NCEI_GFS_GRID4_FORECAST_START) {
      throw new Error(
        `NCEI GFS Grid 4 forecast history begins at ${NCEI_GFS_GRID4_FORECAST_START.toISOString()}`,
      );
    }

    const validTime = new Date(query.runTime.getTime() + forecastHour * 60 * 60 * 1_000);
    if (validTime > this.now()) throw new Error("Archived GFS forecast validTime must not be in the future");

    const adapter: HistoricalAnalysisDataSource = {
      fetch: async (request) => this.source.fetch({
        runTime: query.runTime,
        forecastHour,
        latitude: request.latitude,
        longitude: request.longitude,
        variables: request.variables,
      }),
    };
    const normalizer = new HistoricalProfileService({ source: adapter, now: this.now });
    const profile = await normalizer.getHistoricalProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      analysisTime: validTime.toISOString(),
      variables: [...query.variables],
      pressureLevelsHpa: [...query.pressureLevelsHpa],
    });

    return {
      model: "gfs_grid4_forecast_0p5_archive",
      runTime: query.runTime.toISOString(),
      forecastHour,
      validTime: validTime.toISOString(),
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      levels: profile.levels,
      source: profile.source,
    };
  }
}
