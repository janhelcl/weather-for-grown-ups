import type { UpstreamAccessPolicy } from "../access/access-policy.js";
import {
  DataUnavailableError,
  UpstreamUnavailableError,
} from "../failure.js";
import { AwsGfsAnalysisSource } from "./gfs-analysis-aws.js";
import {
  NceiGfsFileServerAnalysisSource,
  type GfsAnalysisFileStore,
} from "./gfs-analysis-fileserver.js";
import type {
  HistoricalAnalysisAreaDataSource,
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisRequest,
  HistoricalAnalysisSource,
} from "./gfs-analysis.js";
import { GFS_S3_ARCHIVE_START } from "./gfs-s3.js";
import { NceiGfsHistorySource } from "./ncei-gfs-history.js";

export interface RoutedGfsAnalysisSourceOptions {
  aws?: HistoricalAnalysisSource;
  fileServer?: HistoricalAnalysisDataSource;
  ncss?: HistoricalAnalysisSource;
  /** Required unless `aws` / `fileServer` / `ncss` are all injected. */
  awsAccessPolicy?: UpstreamAccessPolicy;
  nceiAccessPolicy?: UpstreamAccessPolicy;
  fileStore?: GfsAnalysisFileStore;
  fetchFn?: typeof fetch;
}

/**
 * Route gfs-analysis requests onto a source that actually supports the requested
 * operation:
 *
 * - point, ≥ 2021-01-01 → NOAA AWS Open Data 0.50° `f000` + NCSS fallback;
 * - point, 2007–2020 → NCEI THREDDS fileServer + NCSS fallback;
 * - area, ≥ 2021-01-01 → NOAA AWS Open Data + NCSS fallback;
 * - area, 2007–2020 → NCSS directly because fileServer has no subset/index API.
 *
 * The router never represents a source capability gap as a retryable upstream
 * failure merely to trigger another source.
 */
export class RoutedGfsAnalysisSource
implements HistoricalAnalysisDataSource, HistoricalAnalysisAreaDataSource {
  private readonly aws: HistoricalAnalysisSource;
  private readonly fileServer: HistoricalAnalysisDataSource;
  private readonly ncss: HistoricalAnalysisSource;

  constructor(options: RoutedGfsAnalysisSourceOptions = {}) {
    this.aws = options.aws ?? new AwsGfsAnalysisSource({
      ...(options.awsAccessPolicy === undefined ? {} : { accessPolicy: options.awsAccessPolicy }),
      ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
    });
    if (options.fileServer !== undefined) {
      this.fileServer = options.fileServer;
    } else {
      if (options.nceiAccessPolicy === undefined) {
        throw new Error("RoutedGfsAnalysisSource requires nceiAccessPolicy when fileServer is not injected");
      }
      this.fileServer = new NceiGfsFileServerAnalysisSource({
        accessPolicy: options.nceiAccessPolicy,
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
        ...(options.fileStore === undefined ? {} : { fileStore: options.fileStore }),
      });
    }
    if (options.ncss !== undefined) {
      this.ncss = options.ncss;
    } else {
      if (options.nceiAccessPolicy === undefined) {
        throw new Error("RoutedGfsAnalysisSource requires nceiAccessPolicy when ncss is not injected");
      }
      this.ncss = new NceiGfsHistorySource({
        limiter: options.nceiAccessPolicy,
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      });
    }
  }

  fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    const primary = request.analysisTime >= GFS_S3_ARCHIVE_START ? this.aws : this.fileServer;
    return this.withFallback(
      () => primary.fetch(request),
      () => this.ncss.fetch(request),
    );
  }

  fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisAreaResponse> {
    if (request.analysisTime < GFS_S3_ARCHIVE_START) {
      return this.ncss.fetchArea(request);
    }
    return this.withFallback(
      () => this.aws.fetchArea(request),
      () => this.ncss.fetchArea(request),
    );
  }

  private async withFallback<T>(
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
}

function isFallbackEligible(error: unknown): boolean {
  return error instanceof UpstreamUnavailableError
    || error instanceof DataUnavailableError;
}
