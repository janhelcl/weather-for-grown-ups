import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UpstreamAccessPolicy } from "../cache/file-access-policy.js";

export const NCEI_GFS_HISTORY_BASE_URL = "https://www.ncei.noaa.gov/thredds/ncss/grid";
export const NCEI_GFS_GRID4_ANALYSIS_START = new Date("2007-01-01T00:00:00Z");
const NCEI_GFS_GRID4_NAMING_TRANSITION = new Date("2020-06-01T00:00:00Z");

export interface HistoricalAnalysisRequest {
  analysisTime: Date;
  latitude: number;
  longitude: number;
  variables: readonly string[];
}

export interface HistoricalAnalysisAreaRequest {
  analysisTime: Date;
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
  variables: readonly string[];
  verticalCoordinate?: number;
  horizontalStride?: number;
}

export interface HistoricalAnalysisResponse {
  csv: string;
  dataset: string;
  cacheHit: boolean;
}

export interface HistoricalAnalysisDataSource {
  fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisResponse>;
}

export interface HistoricalAnalysisAreaDataSource {
  fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisResponse>;
}

export interface NceiGfsHistorySourceOptions {
  cacheDir: string;
  limiter: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
}

export class NceiGfsHistorySource implements HistoricalAnalysisDataSource, HistoricalAnalysisAreaDataSource {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: NceiGfsHistorySourceOptions) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisResponse> {
    const dataset = buildNceiGfsAnalysisDatasetPath(request.analysisTime);
    const url = buildNceiGfsAnalysisPointUrl(request);
    return this.fetchCsv(url, dataset, request.analysisTime);
  }

  async fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisResponse> {
    const dataset = buildNceiGfsAnalysisDatasetPath(request.analysisTime);
    const url = buildNceiGfsAnalysisAreaUrl(request);
    return this.fetchCsv(url, dataset, request.analysisTime);
  }

  private async fetchCsv(
    url: string,
    dataset: string,
    analysisTime: Date,
  ): Promise<HistoricalAnalysisResponse> {
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
          `NCEI historical GFS analysis is not available for ${analysisTime.toISOString()} (${dataset})`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `NCEI historical GFS request failed: HTTP ${response.status} ${response.statusText}`,
        );
      }

      const csv = await response.text();
      if (!csv.includes("\n")) {
        throw new Error(`NCEI historical GFS returned an unexpected response: ${csv.slice(0, 240)}`);
      }

      const tempPath = `${cachePath}.${process.pid}.tmp`;
      await writeFile(tempPath, csv, "utf8");
      await rename(tempPath, cachePath);
      return { csv, dataset, cacheHit: false };
    });
  }
}

export function buildNceiGfsAnalysisPointUrl(request: HistoricalAnalysisRequest): string {
  const dataset = buildNceiGfsAnalysisDatasetPath(request.analysisTime);
  const query = new URLSearchParams({
    var: request.variables.join(","),
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
