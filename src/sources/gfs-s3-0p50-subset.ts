import {
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import { upstreamHttpFailure } from "../access/http-failure.js";
import type { HttpRetryExecutionOptions } from "../access/http-retry.js";
import { WFG_USER_AGENT } from "../access/user-agent.js";
import {
  mergeByteRanges,
  parseGribIndex,
  selectAllPressureByteRanges,
  selectNamedLevelByteRanges,
  selectPressureByteRanges,
  type ByteRange,
} from "../grib/index.js";
import type { HistoricalAnalysisSelector } from "./gfs-analysis-grib.js";
import { buildGfsS3ForecastIndexUrl, buildGfsS3ForecastUrl } from "./gfs-s3.js";

export interface GfsS30p50SubsetClientOptions {
  accessPolicy?: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
  rangeConcurrency?: number;
  retryOptions?: HttpRetryExecutionOptions;
  /** Distinguishes analysis vs forecast in upstream failure messages. */
  product: "analysis" | "forecast";
}

/**
 * NOAA AWS Open Data 0.50° `.idx` + byte-range client. Analysis uses `f000`;
 * archived Grid 4 forecasts reuse the same product at the requested lead.
 */
export class GfsS30p50SubsetClient {
  private readonly accessPolicy?: UpstreamAccessPolicy;
  private readonly fetchFn: typeof fetch;
  private readonly rangeConcurrency: number;
  private readonly retryOptions: HttpRetryExecutionOptions;
  private readonly product: "analysis" | "forecast";

  constructor(options: GfsS30p50SubsetClientOptions) {
    if (options.accessPolicy !== undefined) this.accessPolicy = options.accessPolicy;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.rangeConcurrency = options.rangeConcurrency
      ?? UPSTREAM_ACCESS_POLICIES.noaaAws.maxConcurrency;
    this.retryOptions = options.retryOptions ?? {};
    this.product = options.product;
  }

  async fetchSubset(
    run: Date,
    forecastHour: number,
    selectors: readonly HistoricalAnalysisSelector[],
    options: { pressureHpa?: number } = {},
  ): Promise<{ dataset: string; bytes: Uint8Array }> {
    const gribUrl = buildGfsS3ForecastUrl(run, forecastHour, "0p50");
    const indexUrl = buildGfsS3ForecastIndexUrl(run, forecastHour, "0p50");
    const dataset = gribUrl.replace(/^https:\/\//, "");
    const indexText = await this.fetchIndex(indexUrl, run, forecastHour);
    const records = parseGribIndex(indexText);
    const isobaricCodes = selectors.filter((selector) => selector.kind === "isobaric").map((selector) => selector.gfsCode);
    const named = selectors.filter((selector) => selector.kind === "surface_or_column");
    const pressureRanges = isobaricCodes.length === 0
      ? []
      : options.pressureHpa === undefined
        ? selectAllPressureByteRanges(records, isobaricCodes)
        : selectPressureByteRanges(records, isobaricCodes, [options.pressureHpa]);
    const ranges = mergeByteRanges(
      pressureRanges,
      named.length > 0 ? selectNamedLevelByteRanges(records, named) : [],
    );
    if (ranges.length === 0) {
      throw new Error(
        `AWS GFS ${this.product} index selected no byte ranges for ${run.toISOString()} f${String(forecastHour).padStart(3, "0")}`,
      );
    }
    return { dataset, bytes: await this.fetchRanges(gribUrl, ranges) };
  }

  private async fetchIndex(url: string, run: Date, forecastHour: number): Promise<string> {
    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": WFG_USER_AGENT } },
      {
        ...this.retryOptions,
        fetchFn: this.fetchFn,
        ...(this.accessPolicy === undefined ? {} : { accessPolicy: this.accessPolicy }),
      },
    );
    if (!response.ok) {
      throw upstreamHttpFailure({
        provider: "NOAA AWS Open Data",
        operation: `GFS ${this.product} index request`,
        status: response.status,
        statusText: response.statusText,
        resource: `GFS 0p50 ${this.product} ${run.toISOString()} f${String(forecastHour).padStart(3, "0")}`,
        details: { run: run.toISOString(), forecastHour, grid: "0p50" },
      });
    }
    return response.text();
  }

  private async fetchRanges(url: string, ranges: ByteRange[]): Promise<Uint8Array> {
    const chunks = await mapConcurrent(
      ranges,
      this.rangeConcurrency,
      (range) => this.fetchRange(url, range),
    );
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(total);
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
      throw upstreamHttpFailure({
        provider: "NOAA AWS Open Data",
        operation: `GFS ${this.product} byte-range request`,
        status: response.status,
        statusText: response.statusText,
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "GRIB") {
      throw new Error(`NOAA AWS ${this.product} range did not start with a GRIB message (${rangeValue})`);
    }
    return bytes;
  }
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  }));
  return results;
}
