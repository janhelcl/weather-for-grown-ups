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
