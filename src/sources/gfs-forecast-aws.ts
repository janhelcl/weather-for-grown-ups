import {
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import type { HttpRetryExecutionOptions } from "../access/http-retry.js";
import {
  decodePointMessages,
  gridPointsInBox,
  readGribMessagesFromBytes,
} from "../grib/gribberish-runtime.js";
import type {
  HistoricalAnalysisAccess,
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisProvider,
  HistoricalAnalysisRequest,
  HistoricalAnalysisSource,
} from "./gfs-analysis.js";
import {
  historicalAnalysisSelector,
  historicalAnalysisSelectors,
  rowsFromDecodedPointValues,
  type HistoricalAnalysisSelector,
} from "./gfs-analysis-grib.js";
import { GFS_S3_ARCHIVE_START } from "./gfs-s3.js";
import { GfsS30p50SubsetClient } from "./gfs-s3-0p50-subset.js";

const AWS_FORECAST_PROVENANCE = {
  provider: "NOAA AWS Open Data",
  access: "s3_range",
} as const satisfies { provider: HistoricalAnalysisProvider; access: HistoricalAnalysisAccess };

export interface ArchivedGfsForecastCycle {
  runTime: Date;
  forecastHour: number;
  validTime: Date;
}

export interface AwsGfsForecastAnalysisSourceOptions {
  accessPolicy?: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
  rangeConcurrency?: number;
  retryOptions?: HttpRetryExecutionOptions;
}

/**
 * One archived GFS 0.50° forecast step via NOAA AWS Open Data `.idx` byte
 * ranges. Same typed interchange as gfs-analysis so verification and archived
 * query stay on the provider-neutral contract.
 */
export class AwsGfsForecastAnalysisSource implements HistoricalAnalysisSource {
  private readonly client: GfsS30p50SubsetClient;

  constructor(
    private readonly cycle: ArchivedGfsForecastCycle,
    options: AwsGfsForecastAnalysisSourceOptions = {},
  ) {
    this.client = new GfsS30p50SubsetClient({
      product: "forecast",
      ...(options.accessPolicy === undefined ? {} : { accessPolicy: options.accessPolicy }),
      ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      rangeConcurrency: options.rangeConcurrency ?? UPSTREAM_ACCESS_POLICIES.noaaAws.maxConcurrency,
      retryOptions: options.retryOptions ?? {},
    });
  }

  async fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    this.assertCycle(request.analysisTime);
    const selectors = historicalAnalysisSelectors(request.variables);
    const { dataset, bytes } = await this.client.fetchSubset(
      this.cycle.runTime,
      this.cycle.forecastHour,
      selectors,
    );
    const decoded = decodePointMessages(
      readGribMessagesFromBytes(bytes),
      request.longitude,
      request.latitude,
    );
    const rows = rowsFromDecodedPointValues(decoded, selectors);
    if (rows.length === 0) {
      throw new Error(
        `AWS GFS forecast subset decoded no values for ${request.variables.join(",")}`,
      );
    }
    return {
      rows,
      dataset,
      cacheHit: false,
      ...AWS_FORECAST_PROVENANCE,
    };
  }

  async fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisAreaResponse> {
    this.assertCycle(request.analysisTime);
    const selector = historicalAnalysisSelector(request.variable);
    const narrowed = narrowAreaSelector(selector, request.verticalCoordinate);
    const { dataset, bytes } = await this.client.fetchSubset(
      this.cycle.runTime,
      this.cycle.forecastHour,
      [narrowed],
      {
        ...(narrowed.kind === "isobaric" && request.verticalCoordinate !== undefined
          ? { pressureHpa: request.verticalCoordinate / 100 }
          : {}),
      },
    );
    const messages = readGribMessagesFromBytes(bytes);
    if (messages.length !== 1) {
      throw new Error(
        `AWS GFS forecast area subset expected exactly one GRIB record, found ${messages.length}`,
      );
    }
    return {
      variable: request.variable,
      points: gridPointsInBox(messages[0]!, {
        westLongitude: request.westLongitude,
        eastLongitude: request.eastLongitude,
        southLatitude: request.southLatitude,
        northLatitude: request.northLatitude,
      }),
      ...(request.verticalCoordinate === undefined
        ? {}
        : { verticalCoordinate: request.verticalCoordinate }),
      dataset,
      cacheHit: false,
      ...AWS_FORECAST_PROVENANCE,
    };
  }

  private assertCycle(analysisTime: Date): void {
    if (this.cycle.runTime < GFS_S3_ARCHIVE_START) {
      throw new Error(
        `NOAA AWS GFS forecast Open Data begins at ${GFS_S3_ARCHIVE_START.toISOString()}`,
      );
    }
    if (analysisTime.getTime() !== this.cycle.validTime.getTime()) {
      throw new Error(
        `AWS GFS forecast source expected validTime ${this.cycle.validTime.toISOString()}, received ${analysisTime.toISOString()}`,
      );
    }
  }
}

function narrowAreaSelector(
  selector: HistoricalAnalysisSelector,
  verticalCoordinate: number | undefined,
): HistoricalAnalysisSelector {
  if (verticalCoordinate === undefined || selector.kind === "isobaric") return selector;
  if (selector.gribLevel !== undefined) return selector;
  return {
    ...selector,
    gribLevel: `${verticalCoordinate} m above ground`,
  };
}
