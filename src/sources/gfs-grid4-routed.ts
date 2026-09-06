import {
  DataUnavailableError,
  UpstreamUnavailableError,
} from "../failure.js";
import type {
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisRequest,
  HistoricalAnalysisSource,
} from "./gfs-analysis.js";
import { GFS_S3_ARCHIVE_START } from "./gfs-s3.js";

export interface RoutedGfsGrid4HistoricalSourceOptions {
  routeTime: (request: { analysisTime: Date }) => Date;
  aws: HistoricalAnalysisSource;
  fileServer: HistoricalAnalysisDataSource;
  ncss: HistoricalAnalysisSource;
}

/**
 * One routing state machine for the historical GFS Grid 4 product family.
 * Analysis and archived forecasts differ only in how they resolve the routing
 * time and how their concrete source adapters are constructed.
 *
 * Point:
 * - >= 2021-01-01 -> AWS, with NCSS fallback
 * - <  2021-01-01 -> fileServer, with NCSS fallback
 *
 * Area:
 * - >= 2021-01-01 -> AWS, with NCSS fallback
 * - <  2021-01-01 -> NCSS directly (fileServer cannot subset)
 */
export class RoutedGfsGrid4HistoricalSource implements HistoricalAnalysisSource {
  constructor(private readonly options: RoutedGfsGrid4HistoricalSourceOptions) {}

  fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    const routeTime = this.options.routeTime(request);
    const primary = routeTime >= GFS_S3_ARCHIVE_START
      ? this.options.aws
      : this.options.fileServer;
    return withFallback(
      () => primary.fetch(request),
      () => this.options.ncss.fetch(request),
    );
  }

  fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisAreaResponse> {
    const routeTime = this.options.routeTime(request);
    if (routeTime < GFS_S3_ARCHIVE_START) {
      return this.options.ncss.fetchArea(request);
    }
    return withFallback(
      () => this.options.aws.fetchArea(request),
      () => this.options.ncss.fetchArea(request),
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
