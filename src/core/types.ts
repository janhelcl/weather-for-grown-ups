import type { GfsCode } from "../catalog/variables.js";
import type { RawVariableId } from "../schema/query.js";
import type { ProfileAccessMethod, ProfileProvider } from "../sources/types.js";

export interface GridPoint { latitude: number; longitude: number; }
export interface BoundingBox { westLongitude: number; eastLongitude: number; southLatitude: number; northLatitude: number; }

export interface DecodedValue {
  code: GfsCode;
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
  geopotentialHeightGpm?: number;
  specificHumidityKgKg?: number;
  verticalVelocityPaS?: number;
  geometricVerticalVelocityMs?: number;
  absoluteVorticityS1?: number;
  totalCloudCoverPct?: number;
  cloudWaterMixingRatioKgKg?: number;
  ozoneMixingRatioKgKg?: number;
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
  source: SourceProvenance & { cacheHit: boolean };
}

export interface TimeSeriesStep { validTime: string; forecastHour: number; levels: ProfileLevel[]; cacheHit: boolean; }

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

export interface AreaSummaryResult {
  model: "gfs_0p25";
  run: string;
  validTime: string;
  forecastHour: number;
  bbox: BoundingBox;
  variable: { id: RawVariableId; pressureHpa: number; field: string; unit: string };
  statistics: {
    definedGridPoints: number;
    mean: number;
    min: number;
    max: number;
    meanKind: "unweighted_grid_point_mean";
  };
  source: {
    provider: "NOAA NOMADS";
    access: "nomads_grib_filter";
    decoder: "wgrib2";
    cacheHit: boolean;
  };
}
