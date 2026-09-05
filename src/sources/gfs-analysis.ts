import type { GridValuePoint } from "../grib/wgrib2-grid.js";

export const HISTORICAL_ANALYSIS_VARIABLE_IDS = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
  "absolute_vorticity",
  "cloud_water_mixing_ratio",
  "ozone_mixing_ratio",
  "surface_pressure",
  "surface_geopotential_height",
  "surface_temperature",
  "surface_cape",
  "surface_cin",
  "temperature_2m",
  "relative_humidity_2m",
  "specific_humidity_2m",
  "dew_point_2m",
  "u_wind_10m",
  "v_wind_10m",
  "temperature_80m",
  "specific_humidity_80m",
  "pressure_80m",
  "u_wind_80m",
  "v_wind_80m",
  "temperature_100m",
  "u_wind_100m",
  "v_wind_100m",
  "precipitable_water",
  "total_column_cloud_water",
  "column_relative_humidity",
  "total_column_ozone",
] as const;

export type HistoricalAnalysisVariableId =
  (typeof HISTORICAL_ANALYSIS_VARIABLE_IDS)[number];

export interface HistoricalAnalysisRequest {
  analysisTime: Date;
  latitude: number;
  longitude: number;
  variables: readonly HistoricalAnalysisVariableId[];
}

export interface HistoricalAnalysisAreaRequest {
  analysisTime: Date;
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
  variable: HistoricalAnalysisVariableId;
  /** Pa for isobaric variables; metres for height-above-ground variables. */
  verticalCoordinate?: number;
  horizontalStride?: number;
}

export const HISTORICAL_ANALYSIS_PROVIDERS = [
  "NOAA NCEI",
  "NOAA AWS Open Data",
  "NCAR GDEX",
] as const;
export type HistoricalAnalysisProvider = (typeof HISTORICAL_ANALYSIS_PROVIDERS)[number];

export const HISTORICAL_ANALYSIS_ACCESS = [
  "ncei_thredds_ncss",
  "ncei_thredds_fileserver",
  "gdex_thredds_ncss",
  "s3_range",
] as const;
export type HistoricalAnalysisAccess = (typeof HISTORICAL_ANALYSIS_ACCESS)[number];

export interface HistoricalAnalysisPointRow {
  latitude: number;
  longitude: number;
  pressureHpa?: number;
  heightAboveGroundM?: number;
  values: Partial<Record<HistoricalAnalysisVariableId, number>>;
}

interface HistoricalAnalysisProvenance {
  dataset: string;
  cacheHit: boolean;
  provider: HistoricalAnalysisProvider;
  access: HistoricalAnalysisAccess;
}

export interface HistoricalAnalysisPointResponse extends HistoricalAnalysisProvenance {
  rows: readonly HistoricalAnalysisPointRow[];
}

export interface HistoricalAnalysisAreaResponse extends HistoricalAnalysisProvenance {
  variable: HistoricalAnalysisVariableId;
  points: readonly GridValuePoint[];
  verticalCoordinate?: number;
}

export interface HistoricalAnalysisDataSource {
  fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse>;
}

export interface HistoricalAnalysisAreaDataSource {
  fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisAreaResponse>;
}

export type HistoricalAnalysisSource =
  HistoricalAnalysisDataSource & HistoricalAnalysisAreaDataSource;
