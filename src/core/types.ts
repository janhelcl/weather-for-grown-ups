import type { LayerDiagnosticId } from "../catalog/layer-diagnostics.js";
import type {
  NonIsobaricFieldId,
  NonIsobaricNamedLayerId,
  NonIsobaricNamedLevelId,
} from "../catalog/non-isobaric-fields.js";
import type { GfsCode } from "../catalog/variables.js";
import type { RawVariableId } from "../schema/query.js";
import type { ProfileAccessMethod, ProfileProvider } from "../sources/types.js";

export interface GridPoint { latitude: number; longitude: number; }
export interface BoundingBox { westLongitude: number; eastLongitude: number; southLatitude: number; northLatitude: number; }

export interface ForecastInterval {
  startForecastHour: number;
  endForecastHour: number;
}

export interface DecodedValue {
  code: GfsCode;
  pressureHpa?: number;
  surface?: true;
  heightAboveGroundM?: number;
  namedVertical?: string;
  accumulation?: ForecastInterval;
  average?: ForecastInterval;
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
  dewPointC?: number;
  potentialTemperatureK?: number;
  mixingRatioKgKg?: number;
  virtualTemperatureC?: number;
  airDensityKgM3?: number;
}

export type FieldTemporalResult =
  | { type: "instantaneous" }
  | {
      type: "accumulation";
      startForecastHour: number;
      endForecastHour: number;
      startTime: string;
      endTime: string;
    }
  | {
      type: "average";
      startForecastHour: number;
      endForecastHour: number;
      startTime: string;
      endTime: string;
    };

export type NonIsobaricFieldLevelResult =
  | { type: "surface" }
  | { type: "height_above_ground_m"; heightM: number }
  | { type: "named_layer"; id: NonIsobaricNamedLayerId }
  | { type: "named_level"; id: NonIsobaricNamedLevelId };

export interface NonIsobaricFieldResult {
  id: NonIsobaricFieldId;
  level: NonIsobaricFieldLevelResult;
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

export interface LayerDiagnosticResult {
  id: LayerDiagnosticId;
  values: Record<string, number>;
}

export interface LayerDiagnosticsResult {
  model: "gfs_0p25";
  run: string;
  validTime: string;
  forecastHour: number;
  requestedPoint: GridPoint;
  gridPoint: GridPoint;
  layer: {
    lowerPressureHpa: number;
    upperPressureHpa: number;
    lowerGeopotentialHeightGpm: number;
    upperGeopotentialHeightGpm: number;
    depthGpm: number;
  };
  levels: ProfileLevel[];
  diagnostics: LayerDiagnosticResult[];
  source: SourceProvenance & { cacheHit: boolean };
}

export interface BatchPointResult {
  requestedPoint: GridPoint;
  gridPoint: GridPoint;
  levels: ProfileLevel[];
  fields?: NonIsobaricFieldResult[];
}

export interface BatchPointsResult {
  model: "gfs_0p25";
  run: string;
  validTime: string;
  forecastHour: number;
  points: BatchPointResult[];
  source: {
    provider: "NOAA AWS Open Data";
    access: "s3_range";
    decoder: "wgrib2";
    cacheHit: boolean;
  };
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
