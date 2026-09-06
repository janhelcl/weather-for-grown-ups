import type { UpstreamAccessPolicy } from "../access/access-policy.js";
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
import { RoutedGfsGrid4HistoricalSource } from "./gfs-grid4-routed.js";
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

/** Archived Grid 4 forecast adapter over the shared historical routing state machine. */
export class RoutedGfs0p50ForecastAnalysisSource implements HistoricalAnalysisSource {
  private readonly routed: RoutedGfsGrid4HistoricalSource;

  constructor(
    cycle: ArchivedGfsForecastCycle,
    options: RoutedGfs0p50ForecastAnalysisSourceOptions = {},
  ) {
    const aws = options.aws ?? new AwsGfsForecastAnalysisSource(cycle, {
      ...(options.awsAccessPolicy === undefined ? {} : { accessPolicy: options.awsAccessPolicy }),
      ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
    });

    let fileServer: HistoricalAnalysisDataSource;
    if (options.fileServer !== undefined) {
      fileServer = options.fileServer;
    } else {
      if (options.nceiAccessPolicy === undefined) {
        throw new Error("RoutedGfs0p50ForecastAnalysisSource requires nceiAccessPolicy when fileServer is not injected");
      }
      fileServer = new NceiGfsFileServerForecastSource(cycle, {
        accessPolicy: options.nceiAccessPolicy,
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
        ...(options.fileStore === undefined ? {} : { fileStore: options.fileStore }),
      });
    }

    let ncss: HistoricalAnalysisSource;
    if (options.ncss !== undefined) {
      ncss = options.ncss;
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
      ncss = new ArchivedGfsForecastAnalysisAdapter({
        source: ncssForecast,
        areaSource: ncssForecast,
        runTime: cycle.runTime,
        forecastHour: cycle.forecastHour,
        validTime: cycle.validTime,
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
      });
    }

    this.routed = new RoutedGfsGrid4HistoricalSource({
      routeTime: () => cycle.runTime,
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
