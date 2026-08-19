import type { NonIsobaricFieldId, NonIsobaricLevel } from "../catalog/non-isobaric-fields.js";
import type { GfsCode } from "../catalog/variables.js";
import type { RawVariableId } from "../schema/query.js";
import type { ProfileAccessMethod, ProfileProvider } from "../sources/types.js";

export interface GridPoint { latitude: number; longitude: number; }
export interface BoundingBox { westLongitude: number; eastLongitude: number; southLatitude: number; northLatitude: number; }

export interface AccumulationInterval {
  startForecastHour: number;
  endForecastHour: number;
}

export interface DecodedValue {
  code: GfsCode;
  pressureHpa?: number;
  surface?: true;
  heightAboveGroundM?: number;
  accumulation?: AccumulationInterval;
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

export type FieldTemporalResult =
  | { type: "instantaneous" }
  | {
      type: "accumulation";
      startForecastHour: number;
      endForecastHour: number;
      startTime: string;
      endTime: string;
    };

export interface NonIsobaricFieldResult {
  id: NonIsobaricFieldId;
  level: Omit<NonIsobaricLevel, "gribLevel" | "nomadsLevel">;
  temporal: FieldTemporalResult;
  values: Record<string, number>;
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
  fields?: NonIsobaricFieldResult[];
  source: SourceProvenance & { cacheHit: boolean };
}

export interface TimeSeriesStep {
  validTime: string;
  forecastHour: number;
  levels: ProfileLevel[];
  fields?: NonIsobaricFieldResult[];
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
