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

export interface ProfileResult {
  model: "gfs_0p25";
  run: string;
  validTime: string;
  forecastHour: number;
  requestedPoint: GridPoint;
  gridPoint: GridPoint;
  levels: ProfileLevel[];
  source: {
    provider: "NOAA NOMADS";
    decoder: "wgrib2";
    cacheHit: boolean;
  };
}
