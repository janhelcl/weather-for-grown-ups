import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NetCDFReader } from "netcdfjs";
import type { UpstreamAccessPolicy } from "../cache/file-access-policy.js";
import {
  DEFAULT_HTTP_RETRY_MAX_ATTEMPTS,
  isRetryableHttpStatus,
  waitBeforeHttpRetry,
} from "./http-retry.js";
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

const GDEX_MAX_ATTEMPTS = DEFAULT_HTTP_RETRY_MAX_ATTEMPTS;

export interface RdaAreaNetcdfReader {
  dimensions: readonly { name: string; size: number }[];
  dataVariableExists(name: string): boolean;
  getDataVariable(name: string): unknown;
}

export interface RdaGfsForecastHistorySourceOptions {
  cacheDir: string;
  limiter: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
  netcdfReaderFactory?: (data: Uint8Array) => RdaAreaNetcdfReader;
  retryBaseDelayMs?: number;
  retryJitterRatio?: number;
}

export class RdaGfsForecastHistorySource
implements ArchivedGfsForecastDataSource, ArchivedGfsForecastAreaDataSource {
  private readonly fetchFn: typeof fetch;
  private readonly netcdfReaderFactory: (data: Uint8Array) => RdaAreaNetcdfReader;

  constructor(private readonly options: RdaGfsForecastHistorySourceOptions) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.netcdfReaderFactory = options.netcdfReaderFactory
      ?? ((data) => new NetCDFReader(data));
  }

  async fetch(request: ArchivedGfsForecastRequest): Promise<ArchivedGfsForecastResponse> {
    const dataset = buildRdaGfs025ForecastDatasetPath(request.runTime, request.forecastHour);
    return this.fetchCsv(buildRdaGfs025ForecastPointUrl(request), dataset, request.runTime, request.forecastHour);
  }

  async fetchArea(request: ArchivedGfsForecastAreaRequest): Promise<ArchivedGfsForecastResponse> {
    const dataset = buildRdaGfs025ForecastDatasetPath(request.runTime, request.forecastHour);
    return this.fetchAreaNetcdf(
      buildRdaGfs025ForecastAreaUrl(request),
      dataset,
      request,
    );
  }

  private async fetchAreaNetcdf(
    url: string,
    dataset: string,
    request: ArchivedGfsForecastAreaRequest,
  ): Promise<ArchivedGfsForecastResponse> {
    await mkdir(this.options.cacheDir, { recursive: true });
    const cachePath = join(
      this.options.cacheDir,
      `${createHash("sha256").update(url).digest("hex")}.csv`,
    );

    if (await exists(cachePath)) {
      return { csv: await readFile(cachePath, "utf8"), dataset, cacheHit: true };
    }

    for (let attempt = 1; attempt <= GDEX_MAX_ATTEMPTS; attempt += 1) {
      if (await exists(cachePath)) {
        return { csv: await readFile(cachePath, "utf8"), dataset, cacheHit: true };
      }

      const result = await this.options.limiter.run(async () => {
        const response = await this.fetchFn(url, {
          headers: { "user-agent": "weather-for-grown-ups/0.1" },
        });
        return {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get("retry-after"),
          bytes: response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined,
        };
      });

      if (isRetryableHttpStatus(result.status) && attempt < GDEX_MAX_ATTEMPTS) {
        await waitBeforeHttpRetry(attempt, result.retryAfter, {
          ...(this.options.retryBaseDelayMs === undefined
            ? {}
            : { baseDelayMs: this.options.retryBaseDelayMs }),
          ...(this.options.retryJitterRatio === undefined
            ? {}
            : { jitterRatio: this.options.retryJitterRatio }),
        });
        continue;
      }
      if (result.status === 404) {
        throw new Error(
          `NCAR/GDEX historical GFS 0.25 forecast is not available for run ${request.runTime.toISOString()} f${formatForecastHour(request.forecastHour)} (${dataset})`,
        );
      }
      if (result.status < 200 || result.status >= 300 || result.bytes === undefined) {
        throw new Error(
          `NCAR/GDEX historical GFS 0.25 area request failed: HTTP ${result.status} ${result.statusText}`,
        );
      }

      let csv: string;
      try {
        csv = convertRdaGfs025AreaNetcdfToCsv(
          this.netcdfReaderFactory(result.bytes),
          request,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `NCAR/GDEX historical GFS 0.25 area response could not be decoded: ${message}`,
        );
      }

      const tempPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tempPath, csv, "utf8");
      await rename(tempPath, cachePath);
      return { csv, dataset, cacheHit: false };
    }

    throw new Error("NCAR/GDEX historical GFS 0.25 area retry loop exhausted unexpectedly");
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

    for (let attempt = 1; attempt <= GDEX_MAX_ATTEMPTS; attempt += 1) {
      if (await exists(cachePath)) {
        return { csv: await readFile(cachePath, "utf8"), dataset, cacheHit: true };
      }

      const result = await this.options.limiter.run(async () => {
        const response = await this.fetchFn(url, {
          headers: { "user-agent": "weather-for-grown-ups/0.1" },
        });
        return {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get("retry-after"),
          csv: response.ok ? await response.text() : undefined,
        };
      });

      if (isRetryableHttpStatus(result.status) && attempt < GDEX_MAX_ATTEMPTS) {
        await waitBeforeHttpRetry(attempt, result.retryAfter, {
          ...(this.options.retryBaseDelayMs === undefined
            ? {}
            : { baseDelayMs: this.options.retryBaseDelayMs }),
          ...(this.options.retryJitterRatio === undefined
            ? {}
            : { jitterRatio: this.options.retryJitterRatio }),
        });
        continue;
      }
      if (result.status === 404) {
        throw new Error(
          `NCAR/GDEX historical GFS 0.25 forecast is not available for run ${runTime.toISOString()} f${formatForecastHour(forecastHour)} (${dataset})`,
        );
      }
      if (result.status < 200 || result.status >= 300 || result.csv === undefined) {
        throw new Error(
          `NCAR/GDEX historical GFS 0.25 request failed: HTTP ${result.status} ${result.statusText}`,
        );
      }
      if (!result.csv.includes("\n")) {
        throw new Error(
          `NCAR/GDEX historical GFS 0.25 returned an unexpected response: ${result.csv.slice(0, 240)}`,
        );
      }

      const tempPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tempPath, result.csv, "utf8");
      await rename(tempPath, cachePath);
      return { csv: result.csv, dataset, cacheHit: false };
    }

    throw new Error("NCAR/GDEX historical GFS 0.25 retry loop exhausted unexpectedly");
  }
}

export function convertRdaGfs025AreaNetcdfToCsv(
  reader: RdaAreaNetcdfReader,
  request: ArchivedGfsForecastAreaRequest,
): string {
  const latitudes = numericValues(reader.getDataVariable("latitude"), "latitude");
  const longitudes = numericValues(reader.getDataVariable("longitude"), "longitude");
  if (latitudes.length === 0 || longitudes.length === 0) {
    throw new Error("NetCDF area subset contains an empty latitude/longitude axis");
  }

  const expectedValueCount = latitudes.length * longitudes.length;
  const variableValues = request.variables.map((name) => {
    if (!reader.dataVariableExists(name)) {
      throw new Error(`NetCDF area subset is missing variable ${name}`);
    }
    const values = numericValues(reader.getDataVariable(name), name);
    if (values.length !== expectedValueCount) {
      throw new Error(
        `NetCDF area variable ${name} has ${values.length} values; expected ${expectedValueCount}`,
      );
    }
    return { name, values };
  });

  let vertical:
    | { name: string; value: number }
    | undefined;
  if (request.verticalCoordinate !== undefined) {
    const dimension = reader.dimensions.find((candidate) =>
      candidate.size === 1
      && candidate.name !== "time"
      && candidate.name !== "latitude"
      && candidate.name !== "longitude"
      && reader.dataVariableExists(candidate.name)
    );
    if (dimension === undefined) {
      throw new Error(
        "NetCDF area subset is missing the returned vertical coordinate",
      );
    }
    const values = numericValues(
      reader.getDataVariable(dimension.name),
      dimension.name,
    );
    const value = values[0];
    if (value === undefined) {
      throw new Error(
        `NetCDF area subset has no value for vertical coordinate ${dimension.name}`,
      );
    }
    vertical = { name: dimension.name, value };
  }

  const header = [
    "latitude",
    "longitude",
    ...(vertical === undefined ? [] : [vertical.name]),
    ...variableValues.map(({ name }) => name),
  ].join(",");
  const rows = [header];

  for (let latitudeIndex = 0; latitudeIndex < latitudes.length; latitudeIndex += 1) {
    for (let longitudeIndex = 0; longitudeIndex < longitudes.length; longitudeIndex += 1) {
      const flatIndex = latitudeIndex * longitudes.length + longitudeIndex;
      rows.push([
        String(latitudes[latitudeIndex]),
        String(longitudes[longitudeIndex]),
        ...(vertical === undefined ? [] : [String(vertical.value)]),
        ...variableValues.map(({ values }) => {
          const value = values[flatIndex];
          return value === undefined || !Number.isFinite(value) ? "NaN" : String(value);
        }),
      ].join(","));
    }
  }
  return rows.join("\n");
}

function numericValues(value: unknown, label: string): number[] {
  const flattened: number[] = [];
  const visit = (item: unknown): void => {
    if (typeof item === "number") {
      flattened.push(item);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (ArrayBuffer.isView(item)) {
      for (const child of Array.from(item as unknown as ArrayLike<number>)) {
        visit(child);
      }
      return;
    }
    throw new Error(`NetCDF variable ${label} has an unsupported data shape`);
  };
  visit(value);
  return flattened;
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
    accept: "netCDF",
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
