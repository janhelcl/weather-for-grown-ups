import { homedir } from "node:os";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import {
  CachedNceiGfsForecastHistorySource,
  CachedRdaGfsForecastHistorySource,
} from "../cache/historical-gfs-cache.js";
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
import { ArchivedGfsForecastAnalysisAdapter } from "../sources/archived-gfs-analysis-adapter.js";
import {
  NCEI_GFS_GRID4_FORECAST_START,
  NceiGfsForecastHistorySource,
  type ArchivedGfsForecastDataSource,
} from "../sources/ncei-gfs-forecast-history.js";
import {
  RDA_GFS_0P25_FORECAST_START,
  RdaGfsForecastHistorySource,
} from "../sources/rda-gfs-forecast-history.js";
import { loadHistoricalProfileData } from "./history.js";
import type { GridPoint } from "../types/decoded.js";

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
  nceiAccessPolicy?: UpstreamAccessPolicy;
  gdexAccessPolicy?: UpstreamAccessPolicy;
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
    const nceiAccessPolicy = options.nceiAccessPolicy
      ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.nceiThredds);
    const gdexAccessPolicy = options.gdexAccessPolicy
      ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.gdex);
    this.nceiSource = options.source ?? new CachedNceiGfsForecastHistorySource(
      join(cacheDir, "ncei-forecast-history"),
      new NceiGfsForecastHistorySource({ limiter: nceiAccessPolicy }),
    );
    this.rdaSource = options.rdaSource ?? new CachedRdaGfsForecastHistorySource(
      join(cacheDir, "rda-forecast-history"),
      new RdaGfsForecastHistorySource({ limiter: gdexAccessPolicy }),
    );
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
    const provenance = grid === "0p50"
      ? { provider: "NOAA NCEI" as const, access: "ncei_thredds_ncss" as const }
      : { provider: "NCAR GDEX" as const, access: "gdex_thredds_ncss" as const };

    const validTime = new Date(query.runTime.getTime() + forecastHour * 60 * 60 * 1_000);
    if (validTime > this.now()) throw new Error("Archived GFS forecast validTime must not be in the future");

    const adapter = new ArchivedGfsForecastAnalysisAdapter({
      source,
      runTime: query.runTime,
      forecastHour,
      validTime,
      ...provenance,
    });
    const loaded = await loadHistoricalProfileData({
      source: adapter,
      analysisTime: validTime,
      latitude: query.latitude,
      longitude: query.longitude,
      variables: query.variables,
      pressureLevelsHpa: query.pressureLevelsHpa,
      nativeSpecificHumidity: grid === "0p25",
    });
    const firstResponse = loaded.responses[0];
    if (!firstResponse) throw new Error("Archived GFS profile resolved no source variables");

    return {
      model: archivedGfsModelId(grid),
      runTime: query.runTime.toISOString(),
      forecastHour,
      validTime: validTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: loaded.gridPoint,
      selection: {
        variables: [...query.variables],
        pressureLevelsHpa: [...query.pressureLevelsHpa],
      },
      levels: loaded.levels,
      source: {
        ...provenance,
        dataset: firstResponse.dataset,
        cacheHit: loaded.responses.every((response) => response.cacheHit),
      },
    };
  }
}
