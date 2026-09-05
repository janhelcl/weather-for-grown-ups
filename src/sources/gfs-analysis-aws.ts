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
import {
  decodePointMessages,
  gridPointsInBox,
  readGribMessagesFromBytes,
} from "../grib/gribberish-runtime.js";
import {
  formatHistoricalAreaCsv,
  formatHistoricalPointCsv,
  historicalNcssSelectors,
  heightMetresFromGribLevel,
  rowsFromDecodedPointValues,
} from "./gfs-analysis-grib.js";
import {
  GFS_S3_ARCHIVE_START,
  buildGfsS3ForecastIndexUrl,
  buildGfsS3ForecastUrl,
} from "./gfs-s3.js";
import type {
  HistoricalAnalysisAccess,
  HistoricalAnalysisAreaDataSource,
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisDataSource,
  HistoricalAnalysisProvider,
  HistoricalAnalysisRequest,
  HistoricalAnalysisResponse,
} from "./ncei-gfs-history.js";

const AWS_ANALYSIS_PROVENANCE = {
  provider: "NOAA AWS Open Data",
  access: "s3_range",
} as const satisfies { provider: HistoricalAnalysisProvider; access: HistoricalAnalysisAccess };

export interface AwsGfsAnalysisSourceOptions {
  accessPolicy?: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
  rangeConcurrency?: number;
  retryOptions?: HttpRetryExecutionOptions;
}

/**
 * GFS Grid 4 analysis via NOAA AWS Open Data (`noaa-gfs-bdp-pds`) 0.50°
 * `f000` products with `.idx` byte-range subsetting. Emits NCSS-shaped CSV so
 * the existing historical parsers and services keep working unchanged.
 */
export class AwsGfsAnalysisSource
implements HistoricalAnalysisDataSource, HistoricalAnalysisAreaDataSource {
  private readonly accessPolicy?: UpstreamAccessPolicy;
  private readonly fetchFn: typeof fetch;
  private readonly rangeConcurrency: number;
  private readonly retryOptions: HttpRetryExecutionOptions;

  constructor(options: AwsGfsAnalysisSourceOptions = {}) {
    if (options.accessPolicy !== undefined) this.accessPolicy = options.accessPolicy;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.rangeConcurrency = options.rangeConcurrency
      ?? UPSTREAM_ACCESS_POLICIES.noaaAws.maxConcurrency;
    this.retryOptions = options.retryOptions ?? {};
  }

  async fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisResponse> {
    this.assertAwsEra(request.analysisTime);
    const selectors = historicalNcssSelectors(request.variables);
    const { dataset, bytes } = await this.materializeSubset(request.analysisTime, selectors);
    const messages = readGribMessagesFromBytes(bytes);
    const decoded = decodePointMessages(messages, request.longitude, request.latitude);
    const rows = rowsFromDecodedPointValues(decoded, selectors);
    if (rows.length === 0) {
      throw new Error(
        `AWS GFS analysis subset decoded no values for ${request.variables.join(",")}`,
      );
    }
    return {
      csv: formatHistoricalPointCsv(rows),
      dataset,
      cacheHit: false,
      ...AWS_ANALYSIS_PROVENANCE,
    };
  }

  async fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisResponse> {
    this.assertAwsEra(request.analysisTime);
    if (request.variables.length !== 1) {
      throw new Error("AWS GFS analysis area requests must select exactly one NCSS variable");
    }
    const ncssName = request.variables[0]!;
    const selectors = historicalNcssSelectors([ncssName]);
    const selector = selectors[0]!;
    const narrowed = this.narrowAreaSelector(selector, request.verticalCoordinate);
    const { dataset, bytes } = await this.materializeSubset(
      request.analysisTime,
      [narrowed],
      {
        ...(narrowed.kind === "isobaric" && request.verticalCoordinate !== undefined
          ? { pressureHpa: request.verticalCoordinate / 100 }
          : {}),
      },
    );
    const messages = readGribMessagesFromBytes(bytes);
    if (messages.length !== 1) {
      throw new Error(
        `AWS GFS analysis area subset expected exactly one GRIB record, found ${messages.length}`,
      );
    }
    const points = gridPointsInBox(messages[0]!, {
      westLongitude: request.westLongitude,
      eastLongitude: request.eastLongitude,
      southLatitude: request.southLatitude,
      northLatitude: request.northLatitude,
    });
    return {
      csv: formatHistoricalAreaCsv(ncssName, points, {
        ...(request.verticalCoordinate !== undefined && narrowed.kind === "isobaric"
          ? { pressurePa: request.verticalCoordinate }
          : {}),
        ...(request.verticalCoordinate !== undefined && narrowed.kind === "surface_or_column"
          && narrowed.gribLevel !== undefined
          && heightMetresFromGribLevel(narrowed.gribLevel) !== undefined
          ? { heightAboveGroundM: request.verticalCoordinate }
          : {}),
      }),
      dataset,
      cacheHit: false,
      ...AWS_ANALYSIS_PROVENANCE,
    };
  }

  private assertAwsEra(analysisTime: Date): void {
    if (analysisTime < GFS_S3_ARCHIVE_START) {
      throw new Error(
        `NOAA AWS GFS analysis Open Data begins at ${GFS_S3_ARCHIVE_START.toISOString()}`,
      );
    }
  }

  private narrowAreaSelector(
    selector: ReturnType<typeof historicalNcssSelectors>[number],
    verticalCoordinate: number | undefined,
  ): ReturnType<typeof historicalNcssSelectors>[number] {
    if (verticalCoordinate === undefined || selector.kind === "isobaric") return selector;
    if (selector.gribLevel !== undefined) return selector;
    return {
      ...selector,
      gribLevel: `${verticalCoordinate} m above ground`,
    };
  }

  private async materializeSubset(
    analysisTime: Date,
    selectors: ReturnType<typeof historicalNcssSelectors>,
    options: { pressureHpa?: number } = {},
  ): Promise<{ dataset: string; bytes: Uint8Array }> {
    const gribUrl = buildGfsS3ForecastUrl(analysisTime, 0, "0p50");
    const indexUrl = buildGfsS3ForecastIndexUrl(analysisTime, 0, "0p50");
    const dataset = gribUrl.replace(/^https:\/\//, "");
    const indexText = await this.fetchIndex(indexUrl, analysisTime);
    const records = parseGribIndex(indexText);
    const isobaricCodes = selectors.filter((s) => s.kind === "isobaric").map((s) => s.gfsCode);
    const named = selectors.filter((s) => s.kind === "surface_or_column");
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
      throw new Error(`AWS GFS analysis index selected no byte ranges for ${analysisTime.toISOString()}`);
    }
    return { dataset, bytes: await this.fetchRanges(gribUrl, ranges) };
  }

  private async fetchIndex(url: string, analysisTime: Date): Promise<string> {
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
        operation: "GFS analysis index request",
        status: response.status,
        statusText: response.statusText,
        resource: `GFS 0p50 analysis ${analysisTime.toISOString()}`,
        details: { analysisTime: analysisTime.toISOString(), grid: "0p50" },
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
        operation: "GFS analysis byte-range request",
        status: response.status,
        statusText: response.statusText,
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "GRIB") {
      throw new Error(`NOAA AWS analysis range did not start with a GRIB message (${rangeValue})`);
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
