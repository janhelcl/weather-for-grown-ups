import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileRateLimiter } from "../cache/file-rate-limiter.js";
import { NCEI_GFS_HISTORY_BASE_URL } from "./ncei-gfs-history.js";

export const NCEI_GFS_GRID4_FORECAST_START = new Date("2006-10-10T00:00:00Z");
const NCEI_GFS_GRID4_FORECAST_NAMING_TRANSITION = new Date("2020-06-01T00:00:00Z");

export interface ArchivedGfsForecastRequest {
  runTime: Date;
  forecastHour: number;
  latitude: number;
  longitude: number;
  variables: readonly string[];
}

export interface ArchivedGfsForecastAreaRequest {
  runTime: Date;
  forecastHour: number;
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
  variables: readonly string[];
  verticalCoordinate?: number;
  horizontalStride?: number;
}

export interface ArchivedGfsForecastResponse {
  csv: string;
  dataset: string;
  cacheHit: boolean;
}

export interface ArchivedGfsForecastDataSource {
  fetch(request: ArchivedGfsForecastRequest): Promise<ArchivedGfsForecastResponse>;
}

export interface ArchivedGfsForecastAreaDataSource {
  fetchArea(request: ArchivedGfsForecastAreaRequest): Promise<ArchivedGfsForecastResponse>;
}

export interface NceiGfsForecastHistorySourceOptions {
  cacheDir: string;
  limiter: Pick<FileRateLimiter, "run">;
  fetchFn?: typeof fetch;
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
    await mkdir(this.options.cacheDir, { recursive: true });
    const cachePath = join(
      this.options.cacheDir,
      `${createHash("sha256").update(url).digest("hex")}.csv`,
    );

    if (await exists(cachePath)) {
      return { csv: await readFile(cachePath, "utf8"), dataset, cacheHit: true };
    }

    return this.options.limiter.run(async () => {
      if (await exists(cachePath)) {
        return { csv: await readFile(cachePath, "utf8"), dataset, cacheHit: true };
      }

      const response = await this.fetchFn(url, {
        headers: { "user-agent": "weather-for-grown-ups/0.1" },
      });
      if (response.status === 404) {
        throw new Error(
          `NCEI archived GFS forecast is not available online for run ${runTime.toISOString()} f${formatForecastHour(forecastHour)} (${dataset}). Older forecast data may require NCEI HAS retrieval.`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `NCEI archived GFS forecast request failed: HTTP ${response.status} ${response.statusText}`,
        );
      }

      const csv = await response.text();
      if (!csv.includes("\n")) {
        throw new Error(`NCEI archived GFS forecast returned an unexpected response: ${csv.slice(0, 240)}`);
      }

      const tempPath = `${cachePath}.${process.pid}.tmp`;
      await writeFile(tempPath, csv, "utf8");
      await rename(tempPath, cachePath);
      return { csv, dataset, cacheHit: false };
    });
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
