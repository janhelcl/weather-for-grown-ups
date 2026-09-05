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
import {
  GFS_ANALYSIS_START,
  type HistoricalAnalysisAccess,
  type HistoricalAnalysisDataSource,
  type HistoricalAnalysisPointResponse,
  type HistoricalAnalysisProvider,
  type HistoricalAnalysisRequest,
} from "./gfs-analysis.js";
import {
  historicalAnalysisSelectors,
  rowsFromDecodedPointValues,
} from "./gfs-analysis-grib.js";
import { GFS_S3_ARCHIVE_START } from "./gfs-s3.js";
import { buildNceiGfsAnalysisDatasetPath } from "./ncei-gfs-history.js";

export const NCEI_GFS_FILESERVER_BASE_URL = "https://www.ncei.noaa.gov/thredds/fileServer";

const FILESERVER_PROVENANCE = {
  provider: "NOAA NCEI",
  access: "ncei_thredds_fileserver",
} as const satisfies { provider: HistoricalAnalysisProvider; access: HistoricalAnalysisAccess };

/**
 * Optional immutable object store for the ~150 MB Grid 4 analysis files.
 * Implemented by the cache layer so sources stay free of filesystem imports.
 */
export interface GfsAnalysisFileStore {
  getOrCreate(
    url: string,
    loader: () => Promise<Uint8Array>,
  ): Promise<{ bytes: Uint8Array; cacheHit: boolean }>;
}

export interface NceiGfsFileServerAnalysisSourceOptions {
  accessPolicy: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
  retryOptions?: HttpRetryExecutionOptions;
  fileStore?: GfsAnalysisFileStore;
}

/**
 * Pre-AWS Grid 4 point access: download the full ~150 MB GRIB2 object from
 * NCEI's THREDDS fileServer and decode locally. Area subsetting is not a
 * capability of this source and therefore is not part of its interface.
 */
export class NceiGfsFileServerAnalysisSource implements HistoricalAnalysisDataSource {
  private readonly fetchFn: typeof fetch;
  private readonly retryOptions: HttpRetryExecutionOptions;
  private readonly fileStore: GfsAnalysisFileStore | undefined;

  constructor(private readonly options: NceiGfsFileServerAnalysisSourceOptions) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.retryOptions = options.retryOptions ?? {};
    this.fileStore = options.fileStore;
  }

  async fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    this.assertEra(request.analysisTime);
    const selectors = historicalAnalysisSelectors(request.variables);
    const { bytes, dataset, cacheHit } = await this.loadGrib(request.analysisTime);
    const decoded = decodePointMessages(
      readGribMessagesFromBytes(bytes),
      request.longitude,
      request.latitude,
    );
    const rows = rowsFromDecodedPointValues(decoded, selectors);
    if (rows.length === 0) {
      throw new Error(
        `NCEI fileServer GFS analysis decoded no values for ${request.variables.join(",")}`,
      );
    }
    return {
      rows,
      dataset,
      cacheHit,
      ...FILESERVER_PROVENANCE,
    };
  }

  private assertEra(analysisTime: Date): void {
    if (analysisTime < GFS_ANALYSIS_START) {
      throw new Error(
        `GFS Grid 4 history begins at ${GFS_ANALYSIS_START.toISOString()}`,
      );
    }
    if (analysisTime >= GFS_S3_ARCHIVE_START) {
      throw new Error(
        `NCEI fileServer GFS analysis is reserved for cycles before ${GFS_S3_ARCHIVE_START.toISOString()}; use AWS Open Data for later analyses`,
      );
    }
  }

  private async loadGrib(
    analysisTime: Date,
  ): Promise<{ bytes: Uint8Array; dataset: string; cacheHit: boolean }> {
    const dataset = buildNceiGfsAnalysisDatasetPath(analysisTime);
    const url = buildNceiGfsAnalysisFileServerUrl(analysisTime);
    const loader = () => this.download(url, dataset, analysisTime);
    if (this.fileStore === undefined) {
      return { bytes: await loader(), dataset, cacheHit: false };
    }
    const cached = await this.fileStore.getOrCreate(url, loader);
    return { bytes: cached.bytes, dataset, cacheHit: cached.cacheHit };
  }

  private async download(
    url: string,
    dataset: string,
    analysisTime: Date,
  ): Promise<Uint8Array> {
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
        `NCEI has no GFS analysis file for ${analysisTime.toISOString()}`,
        { details: { provider: "NOAA NCEI", dataset, analysisTime: analysisTime.toISOString() } },
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
        operation: "GFS analysis fileServer request",
        status: response.status,
        statusText: response.statusText,
        resource: dataset,
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "GRIB") {
      throw new UpstreamUnavailableError(
        "NOAA NCEI fileServer returned a non-GRIB GFS analysis object",
        { retryable: false, details: { provider: "NOAA NCEI", dataset } },
      );
    }
    return bytes;
  }
}

export function buildNceiGfsAnalysisFileServerUrl(analysisTime: Date): string {
  return `${NCEI_GFS_FILESERVER_BASE_URL}/${buildNceiGfsAnalysisDatasetPath(analysisTime)}`;
}
