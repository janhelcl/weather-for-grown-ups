import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileRateLimiter } from "../cache/file-rate-limiter.js";
import type {
  ArchivedGfsForecastAreaDataSource,
  ArchivedGfsForecastAreaRequest,
  ArchivedGfsForecastDataSource,
  ArchivedGfsForecastRequest,
  ArchivedGfsForecastResponse,
} from "./ncei-gfs-forecast-history.js";

export const RDA_GFS_0P25_FORECAST_START = new Date("2015-01-15T00:00:00Z");
export const RDA_GFS_0P25_NCSS_BASE_URL =
  "https://tds.gdex.ucar.edu/thredds/ncss/grid/files/g/d084001";

export interface RdaGfsForecastHistorySourceOptions {
  cacheDir: string;
  limiter: Pick<FileRateLimiter, "run">;
  fetchFn?: typeof fetch;
}

export class RdaGfsForecastHistorySource
implements ArchivedGfsForecastDataSource, ArchivedGfsForecastAreaDataSource {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: RdaGfsForecastHistorySourceOptions) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async fetch(request: ArchivedGfsForecastRequest): Promise<ArchivedGfsForecastResponse> {
    const dataset = buildRdaGfs025ForecastDatasetPath(request.runTime, request.forecastHour);
    return this.fetchCsv(buildRdaGfs025ForecastPointUrl(request), dataset, request.runTime, request.forecastHour);
  }

  async fetchArea(request: ArchivedGfsForecastAreaRequest): Promise<ArchivedGfsForecastResponse> {
    const dataset = buildRdaGfs025ForecastDatasetPath(request.runTime, request.forecastHour);
    return this.fetchCsv(buildRdaGfs025ForecastAreaUrl(request), dataset, request.runTime, request.forecastHour);
  }

  private async fetchCsv(
    url: string,
    dataset: string,
    runTime: Date,
    forecastHour: number,
  ): Promise<ArchivedGfsForecastResponse> {
    await mkdir(this.options.cacheDir, { recursive: true });
    const cachePath = join(this.options.cacheDir, `${createHash("sha256").update(url).digest("hex")}.csv`);

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
          `NCAR/GDEX historical GFS 0.25 forecast is not available for run ${runTime.toISOString()} f${formatForecastHour(forecastHour)} (${dataset})`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `NCAR/GDEX historical GFS 0.25 request failed: HTTP ${response.status} ${response.statusText}`,
        );
      }

      const csv = await response.text();
      if (!csv.includes("\n")) {
        throw new Error(
          `NCAR/GDEX historical GFS 0.25 returned an unexpected response: ${csv.slice(0, 240)}`,
        );
      }

      const tempPath = `${cachePath}.${process.pid}.tmp`;
      await writeFile(tempPath, csv, "utf8");
      await rename(tempPath, cachePath);
      return { csv, dataset, cacheHit: false };
    });
  }
}

export function buildRdaGfs025ForecastPointUrl(request: ArchivedGfsForecastRequest): string {
  const dataset = buildRdaGfs025ForecastDatasetPath(request.runTime, request.forecastHour);
  const query = new URLSearchParams({
    var: request.variables.join(","),
    latitude: String(request.latitude),
    longitude: String(request.longitude),
    time: "all",
    accept: "csv",
  });
  return `${RDA_GFS_0P25_NCSS_BASE_URL}/${dataset}?${query.toString()}`;
}

export function buildRdaGfs025ForecastAreaUrl(request: ArchivedGfsForecastAreaRequest): string {
  const dataset = buildRdaGfs025ForecastDatasetPath(request.runTime, request.forecastHour);
  const query = new URLSearchParams({
    var: request.variables.join(","),
    north: String(request.northLatitude),
    south: String(request.southLatitude),
    east: String(request.eastLongitude),
    west: String(request.westLongitude),
    time: "all",
    accept: "csv",
  });
  if (request.verticalCoordinate !== undefined) query.set("vertCoord", String(request.verticalCoordinate));
  if (request.horizontalStride !== undefined) query.set("horizStride", String(request.horizontalStride));
  return `${RDA_GFS_0P25_NCSS_BASE_URL}/${dataset}?${query.toString()}`;
}

export function buildRdaGfs025ForecastDatasetPath(runTime: Date, forecastHour: number): string {
  const year = String(runTime.getUTCFullYear());
  const day = yyyymmdd(runTime);
  const hour = runTime.getUTCHours().toString().padStart(2, "0");
  return `${year}/${day}/gfs.0p25.${day}${hour}.f${formatForecastHour(forecastHour)}.grib2`;
}

function formatForecastHour(forecastHour: number): string {
  return Math.round(forecastHour).toString().padStart(3, "0");
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
