import type { UpstreamAccessPolicy } from "../access/access-policy.js";
import { AwsGfsAnalysisSource } from "./gfs-analysis-aws.js";
import {
  NceiGfsFileServerAnalysisSource,
  type GfsAnalysisFileStore,
} from "./gfs-analysis-fileserver.js";
import type {
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisRequest,
  HistoricalAnalysisSource,
} from "./gfs-analysis.js";
import { RoutedGfsGrid4HistoricalSource } from "./gfs-grid4-routed.js";
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
 * Historical GFS analysis adapter over the shared Grid 4 routing state machine.
 * Concrete analysis sources are built here; fallback semantics live in one place.
 */
export class RoutedGfsAnalysisSource
implements HistoricalAnalysisDataSource, HistoricalAnalysisSource {
  private readonly routed: RoutedGfsGrid4HistoricalSource;

  constructor(options: RoutedGfsAnalysisSourceOptions = {}) {
    const aws = options.aws ?? new AwsGfsAnalysisSource({
      ...(options.awsAccessPolicy === undefined ? {} : { accessPolicy: options.awsAccessPolicy }),
      ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
    });

    let fileServer: HistoricalAnalysisDataSource;
    if (options.fileServer !== undefined) {
      fileServer = options.fileServer;
    } else {
      if (options.nceiAccessPolicy === undefined) {
        throw new Error("RoutedGfsAnalysisSource requires nceiAccessPolicy when fileServer is not injected");
      }
      fileServer = new NceiGfsFileServerAnalysisSource({
        accessPolicy: options.nceiAccessPolicy,
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
        ...(options.fileStore === undefined ? {} : { fileStore: options.fileStore }),
      });
    }

    let ncss: HistoricalAnalysisSource;
    if (options.ncss !== undefined) {
      ncss = options.ncss;
    } else {
      if (options.nceiAccessPolicy === undefined) {
        throw new Error("RoutedGfsAnalysisSource requires nceiAccessPolicy when ncss is not injected");
      }
      ncss = new NceiGfsHistorySource({
        limiter: options.nceiAccessPolicy,
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      });
    }

    this.routed = new RoutedGfsGrid4HistoricalSource({
      routeTime: (request) => request.analysisTime,
      aws,
      fileServer,
      ncss,
    });
  }

  fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    return this.routed.fetch(request);
  }

  fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisAreaResponse> {
    return this.routed.fetchArea(request);
  }
}
