import {
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import type { HttpRetryExecutionOptions } from "../access/http-retry.js";
import { decodePointGribBytes } from "../grib/gribberish-point.js";
import {
  gridPointsInBox,
  readGribMessagesFromBytes,
} from "../grib/gribberish-runtime.js";
import type {
  HistoricalAnalysisAccess,
  HistoricalAnalysisAreaDataSource,
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisProvider,
  HistoricalAnalysisRequest,
} from "./gfs-analysis.js";
import {
  historicalAnalysisSelector,
  historicalAnalysisSelectors,
  rowsFromDecodedPointValues,
  type HistoricalAnalysisSelector,
} from "./gfs-analysis-grib.js";
import { GFS_S3_ARCHIVE_START } from "./gfs-s3.js";
import { GfsS30p50SubsetClient } from "./gfs-s3-0p50-subset.js";

const AWS_ANALYSIS_PROVENANCE = {
  provider: "NOAA AWS Open Data",
  access: "s3_range",
} as const satisfies { provider: HistoricalAnalysisProvider; access: HistoricalAnalysisAccess };

export interface AwsGfsAnalysisSourceOptions {
  accessPolicy?: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
  rangeConcurrency?: number;
  retryOptions?: HttpRetryExecutionOptions;
}

/**
 * GFS Grid 4 analysis via NOAA AWS Open Data (`noaa-gfs-bdp-pds`) 0.50°
 * `f000` products with `.idx` byte-range subsetting. GRIB is decoded directly
 * into WFG's provider-neutral historical-analysis representation.
 */
export class AwsGfsAnalysisSource
implements HistoricalAnalysisDataSource, HistoricalAnalysisAreaDataSource {
  private readonly client: GfsS30p50SubsetClient;

  constructor(options: AwsGfsAnalysisSourceOptions = {}) {
    this.client = new GfsS30p50SubsetClient({
      product: "analysis",
      ...(options.accessPolicy === undefined ? {} : { accessPolicy: options.accessPolicy }),
      ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      rangeConcurrency: options.rangeConcurrency ?? UPSTREAM_ACCESS_POLICIES.noaaAws.maxConcurrency,
      retryOptions: options.retryOptions ?? {},
    });
  }

  async fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    this.assertAwsEra(request.analysisTime);
    const selectors = historicalAnalysisSelectors(request.variables);
    const { dataset, bytes } = await this.client.fetchSubset(request.analysisTime, 0, selectors);
    const [decoded] = await decodePointGribBytes(bytes, [{
      longitude: request.longitude,
      latitude: request.latitude,
    }]);
    const rows = rowsFromDecodedPointValues(decoded ?? [], selectors);
    if (rows.length === 0) {
      throw new Error(
        `AWS GFS analysis subset decoded no values for ${request.variables.join(",")}`,
      );
    }
    return {
      rows,
      dataset,
      cacheHit: false,
      ...AWS_ANALYSIS_PROVENANCE,
    };
  }

  async fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisAreaResponse> {
    this.assertAwsEra(request.analysisTime);
    const selector = historicalAnalysisSelector(request.variable);
    const narrowed = this.narrowAreaSelector(selector, request.verticalCoordinate);
    const { dataset, bytes } = await this.client.fetchSubset(
      request.analysisTime,
      0,
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
        `AWS GFS analysis area subset expected exactly one GRIB record, found ${messages.length}`,
      );
    }
    const points = gridPointsInBox(messages[0]!, {
      westLongitude: request.westLongitude,
      eastLongitude: request.eastLongitude,
      southLatitude: request.southLatitude,
      northLatitude: request.northLatitude,
    });
    return {
      variable: request.variable,
      points,
      ...(request.verticalCoordinate === undefined
        ? {}
        : { verticalCoordinate: request.verticalCoordinate }),
      dataset,
      cacheHit: false,
      ...AWS_ANALYSIS_PROVENANCE,
    };
  }

  private assertAwsEra(analysisTime: Date): void {
    if (analysisTime < GFS_S3_ARCHIVE_START) {
      throw new Error(
        `NOAA AWS GFS analysis Open Data begins at ${GFS_S3_ARCHIVE_START.toISOString()}`,
      );
    }
  }

  private narrowAreaSelector(
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
}
