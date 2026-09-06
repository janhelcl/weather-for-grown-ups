import { homedir } from "node:os";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import {
  CachedGfsAnalysisFileStore,
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
import type {
  ArchivedGfsForecastAccess,
  ArchivedGfsForecastDataSource,
  ArchivedGfsForecastProvider,
  ArchivedGfsForecastSource,
} from "../sources/archived-gfs-forecast.js";
import type { HistoricalAnalysisSource } from "../sources/gfs-analysis.js";
import { RoutedGfs0p50ForecastAnalysisSource } from "../sources/gfs-forecast-routed.js";
import {
  NCEI_GFS_GRID4_FORECAST_START,
  NceiGfsForecastHistorySource,
} from "../sources/ncei-gfs-forecast-history.js";
import {
  RDA_GFS_0P25_FORECAST_START,
  RdaGfsForecastHistorySource,
} from "../sources/rda-gfs-forecast-history.js";
import { GFS_S3_ARCHIVE_START } from "../sources/gfs-s3.js";
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
    provider: ArchivedGfsForecastProvider;
    access: ArchivedGfsForecastAccess;
    dataset: string;
    cacheHit: boolean;
  };
}

export interface ArchivedGfsForecastProfileServiceOptions {
  cacheDir?: string;
  nceiAccessPolicy?: UpstreamAccessPolicy;
  awsAccessPolicy?: UpstreamAccessPolicy;
  gdexAccessPolicy?: UpstreamAccessPolicy;
  source?: ArchivedGfsForecastDataSource;
  rdaSource?: ArchivedGfsForecastDataSource;
  routed0p50?: HistoricalAnalysisSource;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

export class ArchivedGfsForecastProfileService {
  private readonly nceiSource: ArchivedGfsForecastDataSource;
  private readonly rdaSource: ArchivedGfsForecastDataSource;
  private readonly nceiAccessPolicy: UpstreamAccessPolicy;
  private readonly awsAccessPolicy: UpstreamAccessPolicy;
  private readonly fileStore: CachedGfsAnalysisFileStore;
  private readonly injectedNcei: boolean;
  private readonly routed0p50: HistoricalAnalysisSource | undefined;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly now: () => Date;

  constructor(options: ArchivedGfsForecastProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.nceiAccessPolicy = options.nceiAccessPolicy
      ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.nceiThredds);
    this.awsAccessPolicy = options.awsAccessPolicy
      ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.noaaAws);
    const gdexAccessPolicy = options.gdexAccessPolicy
      ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.gdex);
    this.injectedNcei = options.source !== undefined;
    this.nceiSource = options.source ?? new CachedNceiGfsForecastHistorySource(
      join(cacheDir, "ncei-forecast-history"),
      new NceiGfsForecastHistorySource({
        limiter: this.nceiAccessPolicy,
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      }),
    );
    this.rdaSource = options.rdaSource ?? new CachedRdaGfsForecastHistorySource(
      join(cacheDir, "rda-forecast-history"),
      new RdaGfsForecastHistorySource({ limiter: gdexAccessPolicy }),
    );
    this.fileStore = new CachedGfsAnalysisFileStore(join(cacheDir, "gfs-forecast-fileserver"));
    this.routed0p50 = options.routed0p50;
    this.fetchFn = options.fetchFn;
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

    const validTime = new Date(query.runTime.getTime() + forecastHour * 60 * 60 * 1_000);
    if (validTime > this.now()) throw new Error("Archived GFS forecast validTime must not be in the future");

    const source = this.analysisSource(grid, query.runTime, forecastHour, validTime);
    const loaded = await loadHistoricalProfileData({
      source,
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
        provider: firstResponse.provider,
        access: firstResponse.access,
        dataset: firstResponse.dataset,
        cacheHit: loaded.responses.every((response) => response.cacheHit),
      },
    };
  }

  private analysisSource(
    grid: GfsGrid,
    runTime: Date,
    forecastHour: number,
    validTime: Date,
  ): HistoricalAnalysisSource {
    if (grid === "0p25") {
      return new ArchivedGfsForecastAnalysisAdapter({
        source: this.rdaSource,
        runTime,
        forecastHour,
        validTime,
        provider: "NCAR GDEX",
        access: "gdex_thredds_ncss",
      });
    }
    if (this.injectedNcei) {
      return new ArchivedGfsForecastAnalysisAdapter({
        source: this.nceiSource,
        runTime,
        forecastHour,
        validTime,
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
      });
    }
    if (this.routed0p50 !== undefined) return this.routed0p50;
    return new RoutedGfs0p50ForecastAnalysisSource(
      { runTime, forecastHour, validTime },
      {
        nceiAccessPolicy: this.nceiAccessPolicy,
        awsAccessPolicy: this.awsAccessPolicy,
        ncssForecastSource: this.nceiSource as ArchivedGfsForecastSource,
        fileStore: this.fileStore,
        ...(this.fetchFn === undefined ? {} : { fetchFn: this.fetchFn }),
      },
    );
  }
}

export function archivedGfs0p50SourceMetadata(runTime: Date): {
  provider: "NOAA NCEI" | "NOAA AWS Open Data";
  access: "ncei_thredds_ncss" | "ncei_thredds_fileserver" | "s3_range";
} {
  return runTime >= GFS_S3_ARCHIVE_START
    ? { provider: "NOAA AWS Open Data", access: "s3_range" }
    : { provider: "NOAA NCEI", access: "ncei_thredds_fileserver" };
}
