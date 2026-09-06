import type { UpstreamAccessPolicy } from "../access/access-policy.js";
import {
  DataUnavailableError,
  UpstreamUnavailableError,
} from "../failure.js";
import { ArchivedGfsForecastAnalysisAdapter } from "./archived-gfs-analysis-adapter.js";
import type { ArchivedGfsForecastSource } from "./archived-gfs-forecast.js";
import {
  AwsGfsForecastAnalysisSource,
  type ArchivedGfsForecastCycle,
} from "./gfs-forecast-aws.js";
import { NceiGfsFileServerForecastSource } from "./gfs-forecast-fileserver.js";
import type { GfsAnalysisFileStore } from "./gfs-analysis-fileserver.js";
import type {
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisRequest,
  HistoricalAnalysisSource,
} from "./gfs-analysis.js";
import { GFS_S3_ARCHIVE_START } from "./gfs-s3.js";
import { NceiGfsForecastHistorySource } from "./ncei-gfs-forecast-history.js";

export interface RoutedGfs0p50ForecastAnalysisSourceOptions {
  aws?: HistoricalAnalysisSource;
  fileServer?: HistoricalAnalysisDataSource;
  ncss?: HistoricalAnalysisSource;
  ncssForecastSource?: ArchivedGfsForecastSource;
  awsAccessPolicy?: UpstreamAccessPolicy;
  nceiAccessPolicy?: UpstreamAccessPolicy;
  fileStore?: GfsAnalysisFileStore;
  fetchFn?: typeof fetch;
}

/**
 * Route one archived GFS 0.50° forecast step onto a source that actually
 * supports the requested operation:
 *
 * - ≥ 2021-01-01 → NOAA AWS Open Data 0.50° + NCSS fallback;
 * - 2006–2020 point → NCEI THREDDS fileServer + NCSS fallback;
 * - 2006–2020 area → NCSS directly because fileServer has no subset/index API.
 */
export class RoutedGfs0p50ForecastAnalysisSource implements HistoricalAnalysisSource {
  private readonly aws: HistoricalAnalysisSource;
  private readonly fileServer: HistoricalAnalysisDataSource;
  private readonly ncss: HistoricalAnalysisSource;
  private readonly cycle: ArchivedGfsForecastCycle;

  constructor(
    cycle: ArchivedGfsForecastCycle,
    options: RoutedGfs0p50ForecastAnalysisSourceOptions = {},
  ) {
    this.cycle = cycle;
    this.aws = options.aws ?? new AwsGfsForecastAnalysisSource(cycle, {
      ...(options.awsAccessPolicy === undefined ? {} : { accessPolicy: options.awsAccessPolicy }),
      ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
    });
    if (options.fileServer !== undefined) {
      this.fileServer = options.fileServer;
    } else {
      if (options.nceiAccessPolicy === undefined) {
        throw new Error("RoutedGfs0p50ForecastAnalysisSource requires nceiAccessPolicy when fileServer is not injected");
      }
      this.fileServer = new NceiGfsFileServerForecastSource(cycle, {
        accessPolicy: options.nceiAccessPolicy,
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
        ...(options.fileStore === undefined ? {} : { fileStore: options.fileStore }),
      });
    }
    if (options.ncss !== undefined) {
      this.ncss = options.ncss;
    } else {
      if (options.nceiAccessPolicy === undefined && options.ncssForecastSource === undefined) {
        throw new Error(
          "RoutedGfs0p50ForecastAnalysisSource requires ncss, ncssForecastSource, or nceiAccessPolicy",
        );
      }
      const ncssForecast = options.ncssForecastSource ?? new NceiGfsForecastHistorySource({
        limiter: options.nceiAccessPolicy!,
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      });
      this.ncss = new ArchivedGfsForecastAnalysisAdapter({
        source: ncssForecast,
        areaSource: ncssForecast,
        runTime: cycle.runTime,
        forecastHour: cycle.forecastHour,
        validTime: cycle.validTime,
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
      });
    }
  }

  fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    const primary = this.cycle.runTime >= GFS_S3_ARCHIVE_START ? this.aws : this.fileServer;
    return withFallback(
      () => primary.fetch(request),
      () => this.ncss.fetch(request),
    );
  }

  fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisAreaResponse> {
    if (this.cycle.runTime < GFS_S3_ARCHIVE_START) {
      return this.ncss.fetchArea(request);
    }
    return withFallback(
      () => this.aws.fetchArea(request),
      () => this.ncss.fetchArea(request),
    );
  }
}

async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await primary();
  } catch (primaryError) {
    if (!isFallbackEligible(primaryError)) throw primaryError;
    try {
      return await fallback();
    } catch (fallbackError) {
      if (isFallbackEligible(fallbackError)) throw primaryError;
      throw fallbackError;
    }
  }
}

function isFallbackEligible(error: unknown): boolean {
  return error instanceof UpstreamUnavailableError
    || error instanceof DataUnavailableError;
}
