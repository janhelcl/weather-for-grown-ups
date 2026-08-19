import type { ProfileAccessMethod, ProfileProvider } from "../sources/types.js";

export interface GridPoint {
  latitude: number;
  longitude: number;
}

export interface DecodedValue {
  code: "TMP" | "RH" | "UGRD" | "VGRD";
  pressureHpa: number;
  value: number;
  gridPoint: GridPoint;
}

export interface ProfileLevel {
  pressureHpa: number;
  temperatureC?: number;
  relativeHumidityPct?: number;
  uWindMs?: number;
  vWindMs?: number;
  windSpeedMs?: number;
  windDirectionDeg?: number;
}

export interface SourceProvenance {
  provider: ProfileProvider;
  access: ProfileAccessMethod;
  decoder: "wgrib2";
}

export interface ProfileResult {
  model: "gfs_0p25";
  run: string;
  validTime: string;
  forecastHour: number;
  requestedPoint: GridPoint;
  gridPoint: GridPoint;
  levels: ProfileLevel[];
  source: SourceProvenance & {
    cacheHit: boolean;
  };
}

export interface TimeSeriesStep {
  validTime: string;
  forecastHour: number;
  levels: ProfileLevel[];
  cacheHit: boolean;
}

export interface TimeSeriesResult {
  model: "gfs_0p25";
  run: string;
  requestedStartTime: string;
  requestedEndTime: string;
  requestedPoint: GridPoint;
  gridPoint: GridPoint;
  source: SourceProvenance;
  series: TimeSeriesStep[];
}
