import {
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import type { HttpRetryExecutionOptions } from "../access/http-retry.js";
import { WFG_USER_AGENT } from "../access/user-agent.js";
import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import type { GfsGrid } from "../catalog/gfs-grid.js";
import {
  mergeByteRanges,
  parseGribIndex,
  selectNonIsobaricByteRanges,
  selectPressureByteRanges,
  type ByteRange,
} from "../grib/index.js";
import type { ProfileDataRequest } from "./types.js";

export const GFS_S3_BASE_URL = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
export const COMPLETE_RUN_MARKER_FORECAST_HOUR = 384;

export interface ForecastAvailabilitySelection {
  variableCodes: readonly string[];
  pressureLevelsHpa: readonly number[];
  fields: readonly RawNonIsobaricFieldDefinition[];
}

export interface RunAvailabilityProbe {
  isRunComplete(run: Date, grid?: GfsGrid): Promise<boolean>;
  isForecastAvailable(
    run: Date,
    forecastHour: number,
    selection: ForecastAvailabilitySelection,
    grid?: GfsGrid,
  ): Promise<boolean>;
}

export interface GfsS3SubsetSource {
  fetchIndex(request: ProfileDataRequest): Promise<string>;
  fetchSubset(request: ProfileDataRequest, indexText: string): Promise<Uint8Array>;
}

export function buildGfsS3ForecastUrl(run: Date, forecastHour: number, grid: GfsGrid = "0p25"): string {
  const date = yyyymmdd(run);
  const hour = run.getUTCHours().toString().padStart(2, "0");
  const fh = forecastHour.toString().padStart(3, "0");
  return `${GFS_S3_BASE_URL}/gfs.${date}/${hour}/atmos/gfs.t${hour}z.pgrb2.${grid}.f${fh}`;
}

export function buildGfsS3ForecastIndexUrl(run: Date, forecastHour: number, grid: GfsGrid = "0p25"): string {
  return `${buildGfsS3ForecastUrl(run, forecastHour, grid)}.idx`;
}

export function buildGfsS3RunMarkerUrl(run: Date, grid: GfsGrid = "0p25"): string {
  return buildGfsS3ForecastIndexUrl(run, COMPLETE_RUN_MARKER_FORECAST_HOUR, grid);
}

export class GfsS3Source implements GfsS3SubsetSource {
  constructor(
    private readonly accessPolicy?: UpstreamAccessPolicy,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly rangeConcurrency: number = UPSTREAM_ACCESS_POLICIES.noaaAws.maxConcurrency,
    private readonly retryOptions: HttpRetryExecutionOptions = {},
  ) {}

  async fetchIndex(request: ProfileDataRequest): Promise<string> {
    const grid = request.grid ?? "0p25";
    const response = await fetchWithRetry(
      buildGfsS3ForecastIndexUrl(request.run, request.forecastHour, grid),
      { headers: { "user-agent": WFG_USER_AGENT } },
      {
        ...this.retryOptions,
        fetchFn: this.fetchFn,
        ...(this.accessPolicy === undefined ? {} : { accessPolicy: this.accessPolicy }),
      },
    );
    if (!response.ok) {
      throw new Error(`NOAA AWS index request failed: HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  async fetchSubset(request: ProfileDataRequest, indexText: string): Promise<Uint8Array> {
    const records = parseGribIndex(indexText);
    const pressureRanges = selectPressureByteRanges(
      records,
      request.variables.map((variable) => variable.gfsCode),
      request.pressureLevelsHpa,
    );
    const fieldRanges = selectNonIsobaricByteRanges(records, request.fields ?? []);
    const ranges = mergeByteRanges(pressureRanges, fieldRanges);
    const grid = request.grid ?? "0p25";
    const gribUrl = buildGfsS3ForecastUrl(request.run, request.forecastHour, grid);
    const chunks = await mapConcurrent(
      ranges,
      this.rangeConcurrency,
      (range) => this.fetchRange(gribUrl, range),
    );

    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  }

  private async fetchRange(url: string, range: ByteRange): Promise<Uint8Array> {
    const rangeValue = `bytes=${range.start}-${range.end ?? ""}`;
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          range: rangeValue,
          "user-agent": WFG_USER_AGENT,
        },
      },
      {
        ...this.retryOptions,
        fetchFn: this.fetchFn,
        ...(this.accessPolicy === undefined ? {} : { accessPolicy: this.accessPolicy }),
      },
    );
    if (response.status !== 206) {
      throw new Error(`NOAA AWS range request failed: HTTP ${response.status} ${response.statusText}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
      throw new Error(`NOAA AWS range did not start with a GRIB message (${rangeValue})`);
    }
    return bytes;
  }
}

export class GfsS3RunProbe implements RunAvailabilityProbe {
  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  async isRunComplete(run: Date, grid: GfsGrid = "0p25"): Promise<boolean> {
    const url = buildGfsS3RunMarkerUrl(run, grid);
    const response = await this.fetchFn(url, {
      method: "HEAD",
      headers: { "user-agent": WFG_USER_AGENT },
    });

    if (response.ok) return true;
    if (response.status === 404) return false;
    throw new Error(
      `GFS run discovery failed: HTTP ${response.status} ${response.statusText} for ${url}`,
    );
  }

  async isForecastAvailable(
    run: Date,
    forecastHour: number,
    selection: ForecastAvailabilitySelection,
    grid: GfsGrid = "0p25",
  ): Promise<boolean> {
    const url = buildGfsS3ForecastIndexUrl(run, forecastHour, grid);
    const response = await this.fetchFn(url, {
      headers: { "user-agent": WFG_USER_AGENT },
    });

    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(
        `GFS forecast discovery failed: HTTP ${response.status} ${response.statusText} for ${url}`,
      );
    }

    const records = parseGribIndex(await response.text());
    try {
      selectPressureByteRanges(records, selection.variableCodes, selection.pressureLevelsHpa);
      selectNonIsobaricByteRanges(records, selection.fields);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("GFS index is missing requested fields:")) {
        return false;
      }
      throw error;
    }
  }
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<U>,
): Promise<U[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("NOAA AWS range concurrency must be a positive integer");
  }
  const result = new Array<U>(values.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      result[index] = await fn(values[index]!);
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
