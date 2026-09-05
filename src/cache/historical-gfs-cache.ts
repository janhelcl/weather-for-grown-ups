import { createHash } from "node:crypto";
import type { GfsAnalysisFileStore } from "../sources/gfs-analysis-fileserver.js";
import type {
  HistoricalAnalysisAccess,
  HistoricalAnalysisAreaDataSource,
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisProvider,
  HistoricalAnalysisRequest,
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
 * is derived from canonical WFG selections, never from a provider URL or NCSS
 * field name. Cached payloads are the typed interchange returned by adapters.
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

  async fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    const cached = await this.cache.getOrCreateText(
      analysisCacheName(analysisRequestKey("point", request)),
      async () => JSON.stringify(toPointPayload(await this.source.fetch(request))),
    );
    const payload = JSON.parse(cached.value) as CachedHistoricalAnalysisPointPayload;
    return { ...payload, cacheHit: cached.cacheHit };
  }

  async fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisAreaResponse> {
    const cached = await this.cache.getOrCreateText(
      analysisCacheName(analysisRequestKey("area", request)),
      async () => JSON.stringify(toAreaPayload(await this.source.fetchArea(request))),
    );
    const payload = JSON.parse(cached.value) as CachedHistoricalAnalysisAreaPayload;
    return { ...payload, cacheHit: cached.cacheHit };
  }
}

interface CachedHistoricalAnalysisProvenance {
  dataset: string;
  provider: HistoricalAnalysisProvider;
  access: HistoricalAnalysisAccess;
}

interface CachedHistoricalAnalysisPointPayload extends CachedHistoricalAnalysisProvenance {
  rows: HistoricalAnalysisPointResponse["rows"];
}

interface CachedHistoricalAnalysisAreaPayload extends CachedHistoricalAnalysisProvenance {
  variable: HistoricalAnalysisAreaResponse["variable"];
  points: HistoricalAnalysisAreaResponse["points"];
  verticalCoordinate?: number;
}

function toPointPayload(response: HistoricalAnalysisPointResponse): CachedHistoricalAnalysisPointPayload {
  return {
    rows: response.rows,
    dataset: response.dataset,
    provider: response.provider,
    access: response.access,
  };
}

function toAreaPayload(response: HistoricalAnalysisAreaResponse): CachedHistoricalAnalysisAreaPayload {
  return {
    variable: response.variable,
    points: response.points,
    ...(response.verticalCoordinate === undefined
      ? {}
      : { verticalCoordinate: response.verticalCoordinate }),
    dataset: response.dataset,
    provider: response.provider,
    access: response.access,
  };
}

function analysisRequestKey(
  kind: "point" | "area",
  request: HistoricalAnalysisRequest | HistoricalAnalysisAreaRequest,
): string {
  if (kind === "point") {
    const point = request as HistoricalAnalysisRequest;
    return JSON.stringify({
      version: 4,
      kind,
      analysisTime: point.analysisTime.toISOString(),
      latitude: point.latitude,
      longitude: point.longitude,
      variables: [...point.variables],
    });
  }
  const area = request as HistoricalAnalysisAreaRequest;
  return JSON.stringify({
    version: 4,
    kind,
    analysisTime: area.analysisTime.toISOString(),
    westLongitude: area.westLongitude,
    eastLongitude: area.eastLongitude,
    southLatitude: area.southLatitude,
    northLatitude: area.northLatitude,
    variable: area.variable,
    verticalCoordinate: area.verticalCoordinate ?? null,
    horizontalStride: area.horizontalStride ?? null,
  });
}

function analysisCacheName(requestKey: string): string {
  return `${createHash("sha256").update(`gfs-analysis-v4\0${requestKey}`).digest("hex")}.json`;
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
