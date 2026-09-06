import type { UpstreamAccessPolicy } from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import { formatHttpStatus, upstreamHttpFailure } from "../access/http-failure.js";
import type { HttpRetryExecutionOptions } from "../access/http-retry.js";
import { WFG_USER_AGENT } from "../access/user-agent.js";
import {
  DataUnavailableError,
  RateLimitedError,
  UpstreamUnavailableError,
} from "../failure.js";
import {
  decodePointMessages,
  readGribMessagesFromBytes,
} from "../grib/gribberish-runtime.js";
import type { ArchivedGfsForecastCycle } from "./gfs-forecast-aws.js";
import type {
  HistoricalAnalysisAccess,
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisProvider,
  HistoricalAnalysisRequest,
} from "./gfs-analysis.js";
import {
  historicalAnalysisSelectors,
  rowsFromDecodedPointValues,
} from "./gfs-analysis-grib.js";
import type { GfsAnalysisFileStore } from "./gfs-analysis-fileserver.js";
import { NCEI_GFS_FILESERVER_BASE_URL } from "./gfs-analysis-fileserver.js";
import { GFS_S3_ARCHIVE_START } from "./gfs-s3.js";
import {
  NCEI_GFS_GRID4_FORECAST_START,
  buildNceiGfsForecastDatasetPath,
} from "./ncei-gfs-forecast-history.js";

const FILESERVER_PROVENANCE = {
  provider: "NOAA NCEI",
  access: "ncei_thredds_fileserver",
} as const satisfies { provider: HistoricalAnalysisProvider; access: HistoricalAnalysisAccess };

export interface NceiGfsFileServerForecastSourceOptions {
  accessPolicy: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
  retryOptions?: HttpRetryExecutionOptions;
  fileStore?: GfsAnalysisFileStore;
}

/**
 * Pre-AWS Grid 4 forecast point access: download the full GRIB2 object from
 * NCEI's THREDDS fileServer and decode locally. Area subsetting is not a
 * capability of this source.
 */
export class NceiGfsFileServerForecastSource implements HistoricalAnalysisDataSource {
  private readonly fetchFn: typeof fetch;
  private readonly retryOptions: HttpRetryExecutionOptions;
  private readonly fileStore: GfsAnalysisFileStore | undefined;

  constructor(
    private readonly cycle: ArchivedGfsForecastCycle,
    private readonly options: NceiGfsFileServerForecastSourceOptions,
  ) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.retryOptions = options.retryOptions ?? {};
    this.fileStore = options.fileStore;
  }

  async fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    this.assertCycle(request.analysisTime);
    const selectors = historicalAnalysisSelectors(request.variables);
    const { bytes, dataset, cacheHit } = await this.loadGrib();
    const rows = rowsFromDecodedPointValues(
      decodePointMessages(
        readGribMessagesFromBytes(bytes),
        request.longitude,
        request.latitude,
      ),
      selectors,
    );
    if (rows.length === 0) {
      throw new Error(
        `NCEI fileServer GFS forecast decoded no values for ${request.variables.join(",")}`,
      );
    }
    return {
      rows,
      dataset,
      cacheHit,
      ...FILESERVER_PROVENANCE,
    };
  }

  private assertCycle(analysisTime: Date): void {
    if (this.cycle.runTime < NCEI_GFS_GRID4_FORECAST_START) {
      throw new Error(
        `GFS Grid 4 forecast history begins at ${NCEI_GFS_GRID4_FORECAST_START.toISOString()}`,
      );
    }
    if (this.cycle.runTime >= GFS_S3_ARCHIVE_START) {
      throw new Error(
        `NCEI fileServer GFS forecast is reserved for cycles before ${GFS_S3_ARCHIVE_START.toISOString()}; use AWS Open Data for later forecasts`,
      );
    }
    if (analysisTime.getTime() !== this.cycle.validTime.getTime()) {
      throw new Error(
        `NCEI fileServer GFS forecast expected validTime ${this.cycle.validTime.toISOString()}, received ${analysisTime.toISOString()}`,
      );
    }
  }

  private async loadGrib(): Promise<{ bytes: Uint8Array; dataset: string; cacheHit: boolean }> {
    const dataset = buildNceiGfsForecastDatasetPath(this.cycle.runTime, this.cycle.forecastHour);
    const url = buildNceiGfsForecastFileServerUrl(this.cycle.runTime, this.cycle.forecastHour);
    const loader = () => this.download(url, dataset);
    if (this.fileStore === undefined) {
      return { bytes: await loader(), dataset, cacheHit: false };
    }
    const cached = await this.fileStore.getOrCreate(url, loader);
    return { bytes: cached.bytes, dataset, cacheHit: cached.cacheHit };
  }

  private async download(url: string, dataset: string): Promise<Uint8Array> {
    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": WFG_USER_AGENT } },
      {
        ...this.retryOptions,
        fetchFn: this.fetchFn,
        accessPolicy: this.options.accessPolicy,
      },
    );
    if (response.status === 404) {
      throw new DataUnavailableError(
        `NCEI has no archived GFS forecast file for run ${this.cycle.runTime.toISOString()} f${String(this.cycle.forecastHour).padStart(3, "0")}`,
        {
          details: {
            provider: "NOAA NCEI",
            dataset,
            runTime: this.cycle.runTime.toISOString(),
            forecastHour: this.cycle.forecastHour,
          },
        },
      );
    }
    if (response.status === 429) {
      throw new RateLimitedError(
        "NOAA NCEI rate limit remained exhausted after retries",
        { details: { provider: "NOAA NCEI", status: response.status } },
      );
    }
    if (response.status >= 500 && response.status <= 599) {
      throw new UpstreamUnavailableError(
        `NOAA NCEI is unavailable after retries (${formatHttpStatus(response.status, response.statusText)})`,
        { details: { provider: "NOAA NCEI", status: response.status } },
      );
    }
    if (!response.ok) {
      throw upstreamHttpFailure({
        provider: "NOAA NCEI",
        operation: "GFS forecast fileServer request",
        status: response.status,
        statusText: response.statusText,
        resource: dataset,
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "GRIB") {
      throw new UpstreamUnavailableError(
        "NOAA NCEI fileServer returned a non-GRIB archived GFS forecast object",
        { retryable: false, details: { provider: "NOAA NCEI", dataset } },
      );
    }
    return bytes;
  }
}

export function buildNceiGfsForecastFileServerUrl(runTime: Date, forecastHour: number): string {
  return `${NCEI_GFS_FILESERVER_BASE_URL}/${buildNceiGfsForecastDatasetPath(runTime, forecastHour)}`;
}
