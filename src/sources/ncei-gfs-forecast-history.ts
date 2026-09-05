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
  ArchivedGfsForecastAreaDataSource,
  ArchivedGfsForecastAreaRequest,
  ArchivedGfsForecastDataSource,
  ArchivedGfsForecastRequest,
  ArchivedGfsForecastResponse,
} from "./archived-gfs-forecast.js";
import { NCEI_GFS_HISTORY_BASE_URL } from "./ncei-gfs-history.js";

export const NCEI_GFS_GRID4_FORECAST_START = new Date("2006-10-10T00:00:00Z");
const NCEI_GFS_GRID4_FORECAST_NAMING_TRANSITION = new Date("2020-06-01T00:00:00Z");

export interface NceiGfsForecastHistorySourceOptions {
  limiter: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
  retryBaseDelayMs?: number;
  retryJitterRatio?: number;
}

export class NceiGfsForecastHistorySource implements ArchivedGfsForecastDataSource, ArchivedGfsForecastAreaDataSource {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: NceiGfsForecastHistorySourceOptions) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async fetch(request: ArchivedGfsForecastRequest): Promise<ArchivedGfsForecastResponse> {
    const dataset = buildNceiGfsForecastDatasetPath(request.runTime, request.forecastHour);
    return this.fetchCsv(buildNceiGfsForecastPointUrl(request), dataset, request.runTime, request.forecastHour);
  }

  async fetchArea(request: ArchivedGfsForecastAreaRequest): Promise<ArchivedGfsForecastResponse> {
    const dataset = buildNceiGfsForecastDatasetPath(request.runTime, request.forecastHour);
    return this.fetchCsv(buildNceiGfsForecastAreaUrl(request), dataset, request.runTime, request.forecastHour);
  }

  private async fetchCsv(
    url: string,
    dataset: string,
    runTime: Date,
    forecastHour: number,
  ): Promise<ArchivedGfsForecastResponse> {
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
        `NCEI has no archived GFS forecast online for run ${runTime.toISOString()} f${formatForecastHour(forecastHour)}; older data may require NCEI HAS retrieval`,
        {
          details: {
            provider: "NOAA NCEI",
            dataset,
            runTime: runTime.toISOString(),
            forecastHour,
          },
        },
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
        `NOAA NCEI rejected the archived GFS request (${formatHttpStatus(result.status, result.statusText)})`,
        {
          retryable: false,
          details: { provider: "NOAA NCEI", status: result.status },
        },
      );
    }
    if (!result.csv.includes("\n")) {
      throw new UpstreamUnavailableError(
        "NOAA NCEI returned an invalid archived GFS response",
        { retryable: false, details: { provider: "NOAA NCEI" } },
      );
    }

    return { csv: result.csv, dataset, cacheHit: false };
  }
}

export function buildNceiGfsForecastPointUrl(request: ArchivedGfsForecastRequest): string {
  const dataset = buildNceiGfsForecastDatasetPath(request.runTime, request.forecastHour);
  const query = new URLSearchParams({
    var: request.variables.join(","),
    latitude: String(request.latitude),
    longitude: String(request.longitude),
    time: "all",
    accept: "csv",
  });
  return `${NCEI_GFS_HISTORY_BASE_URL}/${dataset}?${query.toString()}`;
}

export function buildNceiGfsForecastAreaUrl(request: ArchivedGfsForecastAreaRequest): string {
  const dataset = buildNceiGfsForecastDatasetPath(request.runTime, request.forecastHour);
  const query = new URLSearchParams({
    var: request.variables.join(","),
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

export function buildNceiGfsForecastDatasetPath(runTime: Date, forecastHour: number): string {
  const month = yyyymm(runTime);
  const day = yyyymmdd(runTime);
  const hour = runTime.getUTCHours().toString().padStart(2, "0");
  const forecast = formatForecastHour(forecastHour);
  const root = runTime < NCEI_GFS_GRID4_FORECAST_NAMING_TRANSITION
    ? "model-gfs-004-files-old"
    : "model-gfs-004-files";
  return `${root}/${month}/${day}/gfs_4_${day}_${hour}00_${forecast}.grb2`;
}

function formatForecastHour(forecastHour: number): string {
  return Math.round(forecastHour).toString().padStart(3, "0");
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
