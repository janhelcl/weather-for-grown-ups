import { createHash } from "node:crypto";
import {
  buildNceiGfsAnalysisAreaUrl,
  buildNceiGfsAnalysisDatasetPath,
  buildNceiGfsAnalysisPointUrl,
  NCEI_NCSS_PROVENANCE,
  type HistoricalAnalysisAccess,
  type HistoricalAnalysisAreaDataSource,
  type HistoricalAnalysisAreaRequest,
  type HistoricalAnalysisDataSource,
  type HistoricalAnalysisProvider,
  type HistoricalAnalysisRequest,
  type HistoricalAnalysisResponse,
} from "../sources/ncei-gfs-history.js";
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
import type { GfsAnalysisFileStore } from "../sources/gfs-analysis-fileserver.js";

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


type HistoricalAnalysisSource =
  HistoricalAnalysisDataSource & HistoricalAnalysisAreaDataSource;
type ArchivedForecastSource =
  ArchivedGfsForecastDataSource & ArchivedGfsForecastAreaDataSource;

export class CachedNceiGfsHistorySource
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
      buildNceiGfsAnalysisPointUrl(request),
      buildNceiGfsAnalysisDatasetPath(request.analysisTime),
      () => this.source.fetch(request),
    );
  }

  fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisResponse> {
    return this.fetchCached(
      buildNceiGfsAnalysisAreaUrl(request),
      buildNceiGfsAnalysisDatasetPath(request.analysisTime),
      () => this.source.fetchArea(request),
    );
  }

  private async fetchCached(
    url: string,
    dataset: string,
    loader: () => Promise<HistoricalAnalysisResponse>,
  ): Promise<HistoricalAnalysisResponse> {
    const cached = await this.cache.getOrCreateText(analysisCacheName(url), async () => {
      const response = await loader();
      return JSON.stringify({
        csv: response.csv,
        dataset: response.dataset,
        provider: response.provider,
        access: response.access,
      } satisfies CachedHistoricalAnalysisPayload);
    });
    if (cached.cacheHit) {
      const payload = parseCachedHistoricalAnalysis(cached.value, dataset);
      return { ...payload, cacheHit: true };
    }
    const payload = JSON.parse(cached.value) as CachedHistoricalAnalysisPayload;
    return { ...payload, cacheHit: false };
  }
}

interface CachedHistoricalAnalysisPayload {
  csv: string;
  dataset: string;
  provider: HistoricalAnalysisProvider;
  access: HistoricalAnalysisAccess;
}

function parseCachedHistoricalAnalysis(
  raw: string,
  fallbackDataset: string,
): Omit<HistoricalAnalysisResponse, "cacheHit"> {
  // Legacy plain-CSV cache entries from the NCSS-only era remain readable.
  if (!raw.startsWith("{")) {
    return { csv: raw, dataset: fallbackDataset, ...NCEI_NCSS_PROVENANCE };
  }
  const payload = JSON.parse(raw) as CachedHistoricalAnalysisPayload;
  return {
    csv: payload.csv,
    dataset: payload.dataset,
    provider: payload.provider,
    access: payload.access,
  };
}

function analysisCacheName(url: string): string {
  return `${createHash("sha256").update(`historical-analysis-v2\0${url}`).digest("hex")}.json`;
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
