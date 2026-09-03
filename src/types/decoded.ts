export interface GridPoint {
  latitude: number;
  longitude: number;
}

export interface ForecastInterval {
  startForecastHour: number;
  endForecastHour: number;
}

export interface DecodedValue {
  /** Raw decoder short name, normalized later by dataset-specific application services. */
  code: string;
  pressureHpa?: number;
  surface?: true;
  heightAboveGroundM?: number;
  namedVertical?: string;
  accumulation?: ForecastInterval;
  average?: ForecastInterval;
  maximum?: ForecastInterval;
  value: number;
  gridPoint: GridPoint;
}

export type GribDecoderName = "gribberish" | "wgrib2";
