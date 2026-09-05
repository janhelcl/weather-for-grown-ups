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

export const HISTORICAL_ANALYSIS_PROVIDERS = [
  "NOAA NCEI",
  "NOAA AWS Open Data",
] as const;
export type HistoricalAnalysisProvider = (typeof HISTORICAL_ANALYSIS_PROVIDERS)[number];

export const HISTORICAL_ANALYSIS_ACCESS = [
  "ncei_thredds_ncss",
  "ncei_thredds_fileserver",
  "s3_range",
] as const;
export type HistoricalAnalysisAccess = (typeof HISTORICAL_ANALYSIS_ACCESS)[number];

export interface HistoricalAnalysisResponse {
  /**
   * Canonical historical-analysis interchange consumed by the existing parser
   * layer. Source adapters may produce it from NCSS CSV or decoded GRIB, but
   * callers and caches must not derive identity from a provider-specific URL.
   */
  csv: string;
  dataset: string;
  cacheHit: boolean;
  provider: HistoricalAnalysisProvider;
  access: HistoricalAnalysisAccess;
}

export interface HistoricalAnalysisDataSource {
  fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisResponse>;
}

export interface HistoricalAnalysisAreaDataSource {
  fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisResponse>;
}

export type HistoricalAnalysisSource =
  HistoricalAnalysisDataSource & HistoricalAnalysisAreaDataSource;
