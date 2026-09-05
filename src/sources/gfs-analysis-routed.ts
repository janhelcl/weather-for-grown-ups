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
import { GFS_S3_ARCHIVE_START } from "./gfs-s3.js";
import {
  NceiGfsHistorySource,
  type HistoricalAnalysisAreaDataSource,
  type HistoricalAnalysisAreaRequest,
  type HistoricalAnalysisDataSource,
  type HistoricalAnalysisRequest,
  type HistoricalAnalysisResponse,
} from "./ncei-gfs-history.js";

export interface RoutedGfsAnalysisSourceOptions {
  aws?: HistoricalAnalysisDataSource & HistoricalAnalysisAreaDataSource;
  fileServer?: HistoricalAnalysisDataSource & HistoricalAnalysisAreaDataSource;
  ncss?: HistoricalAnalysisDataSource & HistoricalAnalysisAreaDataSource;
  /** Required unless `aws` / `fileServer` / `ncss` are all injected. */
  awsAccessPolicy?: UpstreamAccessPolicy;
  nceiAccessPolicy?: UpstreamAccessPolicy;
  fileStore?: GfsAnalysisFileStore;
  fetchFn?: typeof fetch;
}

/**
 * Route gfs-analysis requests onto the working upstream for the analysis era:
 *
 * 1. ≥ 2021-01-01 → NOAA AWS Open Data 0.50° `f000` with `.idx` subsetting
 * 2. 2007–2020 → NCEI THREDDS fileServer full-file download + local decode
 * 3. NCSS retained as tertiary fallback when the primary path fails with an
 *    upstream/data-unavailable error (so a repaired NCEI IAM policy comes
 *    back automatically)
 */
export class RoutedGfsAnalysisSource
implements HistoricalAnalysisDataSource, HistoricalAnalysisAreaDataSource {
  private readonly aws: HistoricalAnalysisDataSource & HistoricalAnalysisAreaDataSource;
  private readonly fileServer: HistoricalAnalysisDataSource & HistoricalAnalysisAreaDataSource;
  private readonly ncss: HistoricalAnalysisDataSource & HistoricalAnalysisAreaDataSource;

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

  fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisResponse> {
    return this.route(request.analysisTime, (source) => source.fetch(request));
  }

  fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisResponse> {
    return this.route(request.analysisTime, (source) => source.fetchArea(request));
  }

  private async route(
    analysisTime: Date,
    operation: (
      source: HistoricalAnalysisDataSource & HistoricalAnalysisAreaDataSource,
    ) => Promise<HistoricalAnalysisResponse>,
  ): Promise<HistoricalAnalysisResponse> {
    const primary = analysisTime >= GFS_S3_ARCHIVE_START ? this.aws : this.fileServer;
    try {
      return await operation(primary);
    } catch (primaryError) {
      if (!isFallbackEligible(primaryError)) throw primaryError;
      try {
        return await operation(this.ncss);
      } catch (ncssError) {
        if (isFallbackEligible(ncssError)) throw primaryError;
        throw ncssError;
      }
    }
  }
}

function isFallbackEligible(error: unknown): boolean {
  return error instanceof UpstreamUnavailableError
    || error instanceof DataUnavailableError;
}
