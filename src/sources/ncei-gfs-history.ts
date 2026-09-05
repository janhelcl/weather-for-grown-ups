import { formatHttpStatus } from "../access/http-failure.js";
import { WFG_USER_AGENT } from "../access/user-agent.js";
import type { UpstreamAccessPolicy } from "../access/access-policy.js";
import { runWithHttpRetry } from "../access/http-retry.js";
import {
  DataUnavailableError,
  RateLimitedError,
  UpstreamUnavailableError,
} from "../failure.js";
import type {
  HistoricalAnalysisAreaDataSource,
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisRequest,
} from "./gfs-analysis.js";
import {
  ncssNameForHistoricalAnalysisVariable,
  ncssNamesForHistoricalAnalysisVariables,
  parseHistoricalNcssAreaCsv,
  parseHistoricalNcssPointCsv,
} from "./gfs-analysis-ncss.js";

export const NCEI_GFS_HISTORY_BASE_URL = "https://www.ncei.noaa.gov/thredds/ncss/grid";
export const NCEI_GFS_GRID4_ANALYSIS_START = new Date("2007-01-01T00:00:00Z");
const NCEI_GFS_GRID4_NAMING_TRANSITION = new Date("2020-06-01T00:00:00Z");

export const NCEI_NCSS_PROVENANCE = {
  provider: "NOAA NCEI",
  access: "ncei_thredds_ncss",
} as const;

export interface NceiGfsHistorySourceOptions {
  limiter: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
  retryBaseDelayMs?: number;
  retryJitterRatio?: number;
}

/**
 * NCEI NCSS transport adapter. Canonical WFG historical-analysis IDs enter
 * here; NCSS variable names and CSV parsing do not escape this module.
 */
export class NceiGfsHistorySource implements HistoricalAnalysisDataSource, HistoricalAnalysisAreaDataSource {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: NceiGfsHistorySourceOptions) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    const dataset = buildNceiGfsAnalysisDatasetPath(request.analysisTime);
    const url = buildNceiGfsAnalysisPointUrl(request);
    const csv = await this.fetchCsv(url, dataset, request.analysisTime);
    return {
      rows: parseHistoricalNcssPointCsv(csv, request.variables, {
        latitude: request.latitude,
        longitude: request.longitude,
      }),
      dataset,
      cacheHit: false,
      ...NCEI_NCSS_PROVENANCE,
    };
  }

  async fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisAreaResponse> {
    const dataset = buildNceiGfsAnalysisDatasetPath(request.analysisTime);
    const url = buildNceiGfsAnalysisAreaUrl(request);
    const csv = await this.fetchCsv(url, dataset, request.analysisTime);
    return {
      variable: request.variable,
      points: parseHistoricalNcssAreaCsv(csv, request.variable, request.verticalCoordinate),
      ...(request.verticalCoordinate === undefined
        ? {}
        : { verticalCoordinate: request.verticalCoordinate }),
      dataset,
      cacheHit: false,
      ...NCEI_NCSS_PROVENANCE,
    };
  }

  private async fetchCsv(
    url: string,
    dataset: string,
    analysisTime: Date,
  ): Promise<string> {
    const result = await runWithHttpRetry(
      () => this.options.limiter.run(async () => {
        const response = await this.fetchFn(url, {
          headers: { "user-agent": WFG_USER_AGENT },
        });
        return {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get("retry-after"),
          csv: response.ok ? await response.text() : undefined,
        };
      }),
      {
        ...(this.options.retryBaseDelayMs === undefined
          ? {}
          : { baseDelayMs: this.options.retryBaseDelayMs }),
        ...(this.options.retryJitterRatio === undefined
          ? {}
          : { jitterRatio: this.options.retryJitterRatio }),
      },
    );

    if (result.status === 404) {
      throw new DataUnavailableError(
        `NCEI has no GFS analysis for ${analysisTime.toISOString()}`,
        { details: { provider: "NOAA NCEI", dataset, analysisTime: analysisTime.toISOString() } },
      );
    }
    if (result.status === 429) {
      throw new RateLimitedError(
        "NOAA NCEI rate limit remained exhausted after retries",
        { details: { provider: "NOAA NCEI", status: result.status } },
      );
    }
    if (result.status >= 500 && result.status <= 599) {
      throw new UpstreamUnavailableError(
        `NOAA NCEI is unavailable after retries (${formatHttpStatus(result.status, result.statusText)})`,
        { details: { provider: "NOAA NCEI", status: result.status } },
      );
    }
    if (result.status < 200 || result.status >= 300 || result.csv === undefined) {
      throw new UpstreamUnavailableError(
        `NOAA NCEI rejected the historical GFS request (${formatHttpStatus(result.status, result.statusText)})`,
        {
          retryable: false,
          details: { provider: "NOAA NCEI", status: result.status },
        },
      );
    }
    if (!result.csv.includes("\n")) {
      throw new UpstreamUnavailableError(
        "NOAA NCEI returned an invalid historical GFS response",
        { retryable: false, details: { provider: "NOAA NCEI" } },
      );
    }
    return result.csv;
  }
}

export function buildNceiGfsAnalysisPointUrl(request: HistoricalAnalysisRequest): string {
  const dataset = buildNceiGfsAnalysisDatasetPath(request.analysisTime);
  const query = new URLSearchParams({
    var: ncssNamesForHistoricalAnalysisVariables(request.variables).join(","),
    latitude: String(request.latitude),
    longitude: String(request.longitude),
    time: "all",
    accept: "csv",
  });
  return `${NCEI_GFS_HISTORY_BASE_URL}/${dataset}?${query.toString()}`;
}

export function buildNceiGfsAnalysisAreaUrl(request: HistoricalAnalysisAreaRequest): string {
  const dataset = buildNceiGfsAnalysisDatasetPath(request.analysisTime);
  const query = new URLSearchParams({
    var: ncssNameForHistoricalAnalysisVariable(request.variable),
    north: String(request.northLatitude),
    south: String(request.southLatitude),
    east: String(request.eastLongitude),
    west: String(request.westLongitude),
    time: "all",
    accept: "csv",
  });
  if (request.verticalCoordinate !== undefined) {
    query.set("vertCoord", String(request.verticalCoordinate));
  }
  if (request.horizontalStride !== undefined) {
    query.set("horizStride", String(request.horizontalStride));
  }
  return `${NCEI_GFS_HISTORY_BASE_URL}/${dataset}?${query.toString()}`;
}

export function buildNceiGfsAnalysisDatasetPath(analysisTime: Date): string {
  const month = yyyymm(analysisTime);
  const day = yyyymmdd(analysisTime);
  const hour = analysisTime.getUTCHours().toString().padStart(2, "0");

  if (analysisTime < NCEI_GFS_GRID4_NAMING_TRANSITION) {
    return `model-gfs-g4-anl-files-old/${month}/${day}/gfsanl_4_${day}_${hour}00_000.grb2`;
  }
  return `model-gfs-g4-anl-files/${month}/${day}/gfs_4_${day}_${hour}00_000.grb2`;
}

function yyyymm(date: Date): string {
  return yyyymmdd(date).slice(0, 6);
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
