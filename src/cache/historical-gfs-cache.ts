import { createHash } from "node:crypto";
import type { GfsAnalysisFileStore } from "../sources/gfs-analysis-fileserver.js";
import type {
  HistoricalAnalysisAccess,
  HistoricalAnalysisAreaDataSource,
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisDataSource,
  HistoricalAnalysisProvider,
  HistoricalAnalysisRequest,
  HistoricalAnalysisResponse,
  HistoricalAnalysisSource,
} from "../sources/gfs-analysis.js";
import {
  buildNceiGfsForecastAreaUrl,
  buildNceiGfsForecastDatasetPath,
  buildNceiGfsForecastPointUrl,
  type ArchivedGfsForecastAreaDataSource,
  type ArchivedGfsForecastAreaRequest,
  type ArchivedGfsForecastDataSource,
  type ArchivedGfsForecastRequest,
  type ArchivedGfsForecastResponse,
} from "../sources/ncei-gfs-forecast-history.js";
import {
  buildRdaGfs025ForecastAreaUrl,
  buildRdaGfs025ForecastDatasetPath,
  buildRdaGfs025ForecastPointUrl,
} from "../sources/rda-gfs-forecast-history.js";
import { FileArtifactCache } from "./artifact-cache.js";

export class CachedGfsAnalysisFileStore implements GfsAnalysisFileStore {
  private readonly cache: FileArtifactCache;

  constructor(rootDir: string) {
    this.cache = new FileArtifactCache(rootDir);
  }

  async getOrCreate(
    url: string,
    loader: () => Promise<Uint8Array>,
  ): Promise<{ bytes: Uint8Array; cacheHit: boolean }> {
    const name = `${createHash("sha256").update(`gfs-analysis-fileserver\0${url}`).digest("hex")}.grib2`;
    const cached = await this.cache.getOrCreateBytes(name, loader);
    return { bytes: cached.value, cacheHit: cached.cacheHit };
  }
}

type ArchivedForecastSource =
  ArchivedGfsForecastDataSource & ArchivedGfsForecastAreaDataSource;

/**
 * Provider-neutral cache for the public gfs-analysis contract. Cache identity
 * is derived from the canonical request, never from an NCSS/AWS/fileServer URL,
 * so changing routing or upstream transport does not leak into callers.
 */
export class CachedGfsAnalysisSource
implements HistoricalAnalysisDataSource, HistoricalAnalysisAreaDataSource {
  private readonly cache: FileArtifactCache;

  constructor(
    rootDir: string,
    private readonly source: HistoricalAnalysisSource,
  ) {
    this.cache = new FileArtifactCache(rootDir);
  }

  fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisResponse> {
    return this.fetchCached(
      analysisRequestKey("point", request),
      () => this.source.fetch(request),
    );
  }

  fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisResponse> {
    return this.fetchCached(
      analysisRequestKey("area", request),
      () => this.source.fetchArea(request),
    );
  }

  private async fetchCached(
    requestKey: string,
    loader: () => Promise<HistoricalAnalysisResponse>,
  ): Promise<HistoricalAnalysisResponse> {
    const cached = await this.cache.getOrCreateText(analysisCacheName(requestKey), async () => {
      const response = await loader();
      return JSON.stringify({
        csv: response.csv,
        dataset: response.dataset,
        provider: response.provider,
        access: response.access,
      } satisfies CachedHistoricalAnalysisPayload);
    });
    const payload = JSON.parse(cached.value) as CachedHistoricalAnalysisPayload;
    return { ...payload, cacheHit: cached.cacheHit };
  }
}

interface CachedHistoricalAnalysisPayload {
  csv: string;
  dataset: string;
  provider: HistoricalAnalysisProvider;
  access: HistoricalAnalysisAccess;
}

function analysisRequestKey(
  kind: "point" | "area",
  request: HistoricalAnalysisRequest | HistoricalAnalysisAreaRequest,
): string {
  return JSON.stringify({
    version: 3,
    kind,
    analysisTime: request.analysisTime.toISOString(),
    ...(kind === "point"
      ? {
          latitude: (request as HistoricalAnalysisRequest).latitude,
          longitude: (request as HistoricalAnalysisRequest).longitude,
        }
      : {
          westLongitude: (request as HistoricalAnalysisAreaRequest).westLongitude,
          eastLongitude: (request as HistoricalAnalysisAreaRequest).eastLongitude,
          southLatitude: (request as HistoricalAnalysisAreaRequest).southLatitude,
          northLatitude: (request as HistoricalAnalysisAreaRequest).northLatitude,
          verticalCoordinate: (request as HistoricalAnalysisAreaRequest).verticalCoordinate ?? null,
          horizontalStride: (request as HistoricalAnalysisAreaRequest).horizontalStride ?? null,
        }),
    variables: [...request.variables],
  });
}

function analysisCacheName(requestKey: string): string {
  return `${createHash("sha256").update(`gfs-analysis-v3\0${requestKey}`).digest("hex")}.json`;
}

export class CachedNceiGfsForecastHistorySource
implements ArchivedGfsForecastDataSource, ArchivedGfsForecastAreaDataSource {
  private readonly cache: FileArtifactCache;

  constructor(
    rootDir: string,
    private readonly source: ArchivedForecastSource,
  ) {
    this.cache = new FileArtifactCache(rootDir);
  }

  fetch(request: ArchivedGfsForecastRequest): Promise<ArchivedGfsForecastResponse> {
    return this.fetchCached(
      buildNceiGfsForecastPointUrl(request),
      buildNceiGfsForecastDatasetPath(request.runTime, request.forecastHour),
      () => this.source.fetch(request),
    );
  }

  fetchArea(request: ArchivedGfsForecastAreaRequest): Promise<ArchivedGfsForecastResponse> {
    return this.fetchCached(
      buildNceiGfsForecastAreaUrl(request),
      buildNceiGfsForecastDatasetPath(request.runTime, request.forecastHour),
      () => this.source.fetchArea(request),
    );
  }

  private async fetchCached(
    url: string,
    dataset: string,
    loader: () => Promise<ArchivedGfsForecastResponse>,
  ): Promise<ArchivedGfsForecastResponse> {
    const cached = await this.cache.getOrCreateText(cacheName(url), async () => {
      const response = await loader();
      return response.csv;
    });
    return { csv: cached.value, dataset, cacheHit: cached.cacheHit };
  }
}

export class CachedRdaGfsForecastHistorySource
implements ArchivedGfsForecastDataSource, ArchivedGfsForecastAreaDataSource {
  private readonly cache: FileArtifactCache;

  constructor(
    rootDir: string,
    private readonly source: ArchivedForecastSource,
  ) {
    this.cache = new FileArtifactCache(rootDir);
  }

  fetch(request: ArchivedGfsForecastRequest): Promise<ArchivedGfsForecastResponse> {
    return this.fetchCached(
      buildRdaGfs025ForecastPointUrl(request),
      buildRdaGfs025ForecastDatasetPath(request.runTime, request.forecastHour),
      () => this.source.fetch(request),
    );
  }

  fetchArea(request: ArchivedGfsForecastAreaRequest): Promise<ArchivedGfsForecastResponse> {
    return this.fetchCached(
      buildRdaGfs025ForecastAreaUrl(request),
      buildRdaGfs025ForecastDatasetPath(request.runTime, request.forecastHour),
      () => this.source.fetchArea(request),
    );
  }

  private async fetchCached(
    url: string,
    dataset: string,
    loader: () => Promise<ArchivedGfsForecastResponse>,
  ): Promise<ArchivedGfsForecastResponse> {
    const cached = await this.cache.getOrCreateText(cacheName(url), async () => {
      const response = await loader();
      return response.csv;
    });
    return { csv: cached.value, dataset, cacheHit: cached.cacheHit };
  }
}

function cacheName(url: string): string {
  return `${createHash("sha256").update(url).digest("hex")}.csv`;
}
