export interface ArchivedGfsForecastRequest {
  runTime: Date;
  forecastHour: number;
  latitude: number;
  longitude: number;
  variables: readonly string[];
}

export interface ArchivedGfsForecastAreaRequest {
  runTime: Date;
  forecastHour: number;
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
  variables: readonly string[];
  verticalCoordinate?: number;
  horizontalStride?: number;
}

export interface ArchivedGfsForecastResponse {
  csv: string;
  dataset: string;
  cacheHit: boolean;
}

export interface ArchivedGfsForecastDataSource {
  fetch(request: ArchivedGfsForecastRequest): Promise<ArchivedGfsForecastResponse>;
}

export interface ArchivedGfsForecastAreaDataSource {
  fetchArea(request: ArchivedGfsForecastAreaRequest): Promise<ArchivedGfsForecastResponse>;
}

export type ArchivedGfsForecastSource =
  ArchivedGfsForecastDataSource & ArchivedGfsForecastAreaDataSource;

export const ARCHIVED_GFS_FORECAST_PROVIDERS = [
  "NOAA NCEI",
  "NOAA AWS Open Data",
  "NCAR GDEX",
] as const;
export type ArchivedGfsForecastProvider = (typeof ARCHIVED_GFS_FORECAST_PROVIDERS)[number];

export const ARCHIVED_GFS_FORECAST_ACCESS = [
  "ncei_thredds_ncss",
  "ncei_thredds_fileserver",
  "gdex_thredds_ncss",
  "s3_range",
] as const;
export type ArchivedGfsForecastAccess = (typeof ARCHIVED_GFS_FORECAST_ACCESS)[number];

export interface ArchivedGfsForecastProvenance {
  provider: ArchivedGfsForecastProvider;
  access: ArchivedGfsForecastAccess;
}
