export const ATMOSPHERIC_DATASET_IDS = [
  "gfs_0p25",
  "gfs_0p50",
  "aigfs_0p25",
  "aigefs_0p25",
  "hgefs_0p25",
  "icon_d2_0p02",
  "icon_d2_eps_2p1km",
  "arome_0p01",
  "aifs_0p25",
  "aifs_ens_0p25",
  "gefs_0p50",
  "ifs_0p25",
  "ifs_ens_0p25",
  "gfs_grid4_analysis_0p5",
] as const;

export type AtmosphericDatasetId = (typeof ATMOSPHERIC_DATASET_IDS)[number];
export type AtmosphericDatasetKind = "deterministic" | "ensemble";
export type AtmosphericDatasetRole = "forecast" | "analysis";
export type AtmosphericModelClass = "physics" | "ai" | "hybrid";
export type AtmosphericProvider = "noaa" | "ecmwf" | "dwd" | "meteo_france";
export type AtmosphericSpatialScope = "global" | "limited_area";
export type AtmosphericHorizontalGridType =
  | "regular_latlon"
  | "rotated_latlon"
  | "icosahedral"
  | "lambert_conformal"
  | "mixed";
export type AtmosphericResolutionUnit = "degrees" | "km";

export interface AtmosphericBoundingBox {
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
}

export type AtmosphericSpatialDomain =
  | { scope: "global" }
  | {
      scope: "limited_area";
      name: string;
      bounds: AtmosphericBoundingBox;
    };

export interface AtmosphericNominalResolution {
  value: number;
  unit: AtmosphericResolutionUnit;
}

export interface AtmosphericNativeGrid {
  type: AtmosphericHorizontalGridType;
  nominalResolution?: AtmosphericNominalResolution;
  components?: readonly {
    dataset: AtmosphericDatasetId;
    type: Exclude<AtmosphericHorizontalGridType, "mixed">;
    nominalResolution: AtmosphericNominalResolution;
  }[];
}

export type AtmosphericCoverageGeometry =
  | { type: "point"; latitude: number; longitude: number }
  | { type: "points"; points: readonly { latitude: number; longitude: number }[] }
  | {
      type: "transect";
      start: { latitude: number; longitude: number };
      end: { latitude: number; longitude: number };
    }
  | {
      type: "area";
      westLongitude: number;
      eastLongitude: number;
      southLatitude: number;
      northLatitude: number;
    };

export const ATMOSPHERIC_RUN_SELECTOR_IDS = ["latest", "latest_complete", "explicit"] as const;
export type AtmosphericRunSelectorId = (typeof ATMOSPHERIC_RUN_SELECTOR_IDS)[number];

export const ATMOSPHERIC_OPERATION_IDS = [
  "profile",
  "timeseries",
  "layer_diagnostics",
  "profile_diagnostics",
  "diagnostic_timeseries",
  "parcel_diagnostics",
  "points",
  "points_timeseries",
  "transect",
  "area_summary",
  "run_comparison",
  "ensemble_distribution",
  "aligned_model_comparison",
] as const;

export type AtmosphericOperationId = (typeof ATMOSPHERIC_OPERATION_IDS)[number];

export interface AtmosphericDatasetDefinition {
  id: AtmosphericDatasetId;
  family: "gfs" | "gefs" | "ifs" | "aigfs" | "aigefs" | "hgefs" | "aifs" | "icon-d2" | "icon-d2-eps" | "arome";
  provider: AtmosphericProvider;
  modelClass: AtmosphericModelClass;
  kind: AtmosphericDatasetKind;
  role: AtmosphericDatasetRole;
  /**
   * Compatibility metadata for regular latitude/longitude products.
   * Regional datasets are not required to express their native grid in degrees.
   */
  horizontalGridDegrees?: number;
  spatialDomain: AtmosphericSpatialDomain;
  nativeGrid: AtmosphericNativeGrid;
  maxForecastHour?: number;
  /** Native output intervals that callers may encounter across the forecast horizon/run classes. */
  nativeTimeCadenceHours: readonly number[];
  nativeForecastIntervalHours?: number;
  members?: number;
  constituents?: readonly {
    dataset: AtmosphericDatasetId;
    modelClass: AtmosphericModelClass;
    members: number;
  }[];
  runSelectors: readonly AtmosphericRunSelectorId[];
  operations: readonly AtmosphericOperationId[];
}

export const ATMOSPHERIC_DATASET_CATALOG: Record<AtmosphericDatasetId, AtmosphericDatasetDefinition> = {
  gfs_0p25: {
    id: "gfs_0p25",
    family: "gfs",
    provider: "noaa",
    modelClass: "physics",
    kind: "deterministic",
    role: "forecast",
    horizontalGridDegrees: 0.25,
    spatialDomain: { scope: "global" },
    nativeGrid: { type: "regular_latlon", nominalResolution: { value: 0.25, unit: "degrees" } },
    maxForecastHour: 384,
    nativeTimeCadenceHours: [1, 3],
    runSelectors: ["latest", "latest_complete", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "parcel_diagnostics",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "run_comparison",
      "aligned_model_comparison",
    ],
  },
  gfs_0p50: {
    id: "gfs_0p50",
    family: "gfs",
    provider: "noaa",
    modelClass: "physics",
    kind: "deterministic",
    role: "forecast",
    horizontalGridDegrees: 0.5,
    spatialDomain: { scope: "global" },
    nativeGrid: { type: "regular_latlon", nominalResolution: { value: 0.5, unit: "degrees" } },
    maxForecastHour: 384,
    nativeTimeCadenceHours: [3],
    runSelectors: ["latest", "latest_complete", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "parcel_diagnostics",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "run_comparison",
      "aligned_model_comparison",
    ],
  },
  aigfs_0p25: {
    id: "aigfs_0p25",
    family: "aigfs",
    provider: "noaa",
    modelClass: "ai",
    kind: "deterministic",
    role: "forecast",
    horizontalGridDegrees: 0.25,
    spatialDomain: { scope: "global" },
    nativeGrid: { type: "regular_latlon", nominalResolution: { value: 0.25, unit: "degrees" } },
    maxForecastHour: 384,
    nativeTimeCadenceHours: [6],
    nativeForecastIntervalHours: 6,
    runSelectors: ["latest", "latest_complete", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "aligned_model_comparison",
    ],
  },
  aigefs_0p25: {
    id: "aigefs_0p25",
    family: "aigefs",
    provider: "noaa",
    modelClass: "ai",
    kind: "ensemble",
    role: "forecast",
    horizontalGridDegrees: 0.25,
    spatialDomain: { scope: "global" },
    nativeGrid: { type: "regular_latlon", nominalResolution: { value: 0.25, unit: "degrees" } },
    maxForecastHour: 384,
    nativeTimeCadenceHours: [6],
    nativeForecastIntervalHours: 6,
    members: 31,
    runSelectors: ["latest", "latest_complete", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "ensemble_distribution",
      "aligned_model_comparison",
    ],
  },
  hgefs_0p25: {
    id: "hgefs_0p25",
    family: "hgefs",
    provider: "noaa",
    modelClass: "hybrid",
    kind: "ensemble",
    role: "forecast",
    horizontalGridDegrees: 0.25,
    spatialDomain: { scope: "global" },
    nativeGrid: {
      type: "mixed",
      components: [
        { dataset: "gefs_0p50", type: "regular_latlon", nominalResolution: { value: 0.5, unit: "degrees" } },
        { dataset: "aigefs_0p25", type: "regular_latlon", nominalResolution: { value: 0.25, unit: "degrees" } },
      ],
    },
    maxForecastHour: 240,
    nativeTimeCadenceHours: [6],
    nativeForecastIntervalHours: 6,
    members: 62,
    constituents: [
      { dataset: "gefs_0p50", modelClass: "physics", members: 31 },
      { dataset: "aigefs_0p25", modelClass: "ai", members: 31 },
    ],
    runSelectors: ["latest", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "ensemble_distribution",
      "aligned_model_comparison",
    ],
  },
  icon_d2_0p02: {
    id: "icon_d2_0p02",
    family: "icon-d2",
    provider: "dwd",
    modelClass: "physics",
    kind: "deterministic",
    role: "forecast",
    horizontalGridDegrees: 0.02,
    spatialDomain: {
      scope: "limited_area",
      name: "DWD ICON-D2 conservative core domain",
      bounds: {
        westLongitude: -0.25,
        eastLongitude: 17.54,
        southLatitude: 43.42,
        northLatitude: 57.31,
      },
    },
    nativeGrid: {
      type: "icosahedral",
      nominalResolution: { value: 2.1, unit: "km" },
    },
    maxForecastHour: 48,
    nativeTimeCadenceHours: [1],
    nativeForecastIntervalHours: 1,
    runSelectors: ["latest", "latest_complete", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
    ],
  },
  icon_d2_eps_2p1km: {
    id: "icon_d2_eps_2p1km",
    family: "icon-d2-eps",
    provider: "dwd",
    modelClass: "physics",
    kind: "ensemble",
    role: "forecast",
    spatialDomain: {
      scope: "limited_area",
      name: "DWD ICON-D2-EPS conservative core domain",
      bounds: {
        westLongitude: -0.25,
        eastLongitude: 17.54,
        southLatitude: 43.42,
        northLatitude: 57.31,
      },
    },
    nativeGrid: {
      type: "icosahedral",
      nominalResolution: { value: 2.1, unit: "km" },
    },
    maxForecastHour: 48,
    nativeTimeCadenceHours: [1],
    nativeForecastIntervalHours: 1,
    members: 20,
    runSelectors: ["latest", "latest_complete", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "ensemble_distribution",
    ],
  },
  arome_0p01: {
    id: "arome_0p01",
    family: "arome",
    provider: "meteo_france",
    modelClass: "physics",
    kind: "deterministic",
    role: "forecast",
    horizontalGridDegrees: 0.01,
    spatialDomain: {
      scope: "limited_area",
      name: "Météo-France AROME EURW1S100 public product domain",
      bounds: {
        westLongitude: -12,
        eastLongitude: 16,
        southLatitude: 37.5,
        northLatitude: 55.4,
      },
    },
    nativeGrid: {
      type: "lambert_conformal",
      nominalResolution: { value: 1.3, unit: "km" },
    },
    maxForecastHour: 51,
    nativeTimeCadenceHours: [1],
    nativeForecastIntervalHours: 1,
    runSelectors: ["latest", "latest_complete", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
    ],
  },
  aifs_0p25: {
    id: "aifs_0p25",
    family: "aifs",
    provider: "ecmwf",
    modelClass: "ai",
    kind: "deterministic",
    role: "forecast",
    horizontalGridDegrees: 0.25,
    spatialDomain: { scope: "global" },
    nativeGrid: { type: "regular_latlon", nominalResolution: { value: 0.25, unit: "degrees" } },
    maxForecastHour: 360,
    nativeTimeCadenceHours: [6],
    nativeForecastIntervalHours: 6,
    runSelectors: ["latest", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "aligned_model_comparison",
    ],
  },
  aifs_ens_0p25: {
    id: "aifs_ens_0p25",
    family: "aifs",
    provider: "ecmwf",
    modelClass: "ai",
    kind: "ensemble",
    role: "forecast",
    horizontalGridDegrees: 0.25,
    spatialDomain: { scope: "global" },
    nativeGrid: { type: "regular_latlon", nominalResolution: { value: 0.25, unit: "degrees" } },
    maxForecastHour: 360,
    nativeTimeCadenceHours: [6],
    nativeForecastIntervalHours: 6,
    members: 51,
    runSelectors: ["latest", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "ensemble_distribution",
      "aligned_model_comparison",
    ],
  },
  gefs_0p50: {
    id: "gefs_0p50",
    family: "gefs",
    provider: "noaa",
    modelClass: "physics",
    kind: "ensemble",
    role: "forecast",
    horizontalGridDegrees: 0.5,
    spatialDomain: { scope: "global" },
    nativeGrid: { type: "regular_latlon", nominalResolution: { value: 0.5, unit: "degrees" } },
    maxForecastHour: 384,
    nativeTimeCadenceHours: [3],
    members: 31,
    runSelectors: ["latest", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "parcel_diagnostics",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "run_comparison",
      "ensemble_distribution",
      "aligned_model_comparison",
    ],
  },
  ifs_0p25: {
    id: "ifs_0p25",
    family: "ifs",
    provider: "ecmwf",
    modelClass: "physics",
    kind: "deterministic",
    role: "forecast",
    horizontalGridDegrees: 0.25,
    spatialDomain: { scope: "global" },
    nativeGrid: { type: "regular_latlon", nominalResolution: { value: 0.25, unit: "degrees" } },
    maxForecastHour: 240,
    nativeTimeCadenceHours: [3, 6],
    runSelectors: ["latest", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "parcel_diagnostics",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "run_comparison",
    ],
  },
  ifs_ens_0p25: {
    id: "ifs_ens_0p25",
    family: "ifs",
    provider: "ecmwf",
    modelClass: "physics",
    kind: "ensemble",
    role: "forecast",
    horizontalGridDegrees: 0.25,
    spatialDomain: { scope: "global" },
    nativeGrid: { type: "regular_latlon", nominalResolution: { value: 0.25, unit: "degrees" } },
    maxForecastHour: 360,
    nativeTimeCadenceHours: [3, 6],
    members: 50,
    runSelectors: ["latest", "explicit"],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "parcel_diagnostics",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "run_comparison",
      "ensemble_distribution",
      "aligned_model_comparison",
    ],
  },
  gfs_grid4_analysis_0p5: {
    id: "gfs_grid4_analysis_0p5",
    family: "gfs",
    provider: "noaa",
    modelClass: "physics",
    kind: "deterministic",
    role: "analysis",
    horizontalGridDegrees: 0.5,
    spatialDomain: { scope: "global" },
    nativeGrid: { type: "regular_latlon", nominalResolution: { value: 0.5, unit: "degrees" } },
    nativeTimeCadenceHours: [6],
    runSelectors: [],
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "parcel_diagnostics",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
    ],
  },
};

export function spatialDomainCoversGeometry(
  domain: AtmosphericSpatialDomain,
  geometry: AtmosphericCoverageGeometry,
): boolean {
  if (domain.scope === "global") return true;
  const bounds = domain.bounds;
  const coversPoint = (point: { latitude: number; longitude: number }) =>
    point.latitude >= bounds.southLatitude
    && point.latitude <= bounds.northLatitude
    && point.longitude >= bounds.westLongitude
    && point.longitude <= bounds.eastLongitude;

  switch (geometry.type) {
    case "point":
      return coversPoint(geometry);
    case "points":
      return geometry.points.every(coversPoint);
    case "transect":
      // Limited-area datasets currently declare conservative rectangular coverage.
      // Both endpoints must be inside; dataset integrations may tighten this further
      // if their native domain needs a more exact boundary representation.
      return coversPoint(geometry.start) && coversPoint(geometry.end);
    case "area":
      return geometry.westLongitude >= bounds.westLongitude
        && geometry.eastLongitude <= bounds.eastLongitude
        && geometry.southLatitude >= bounds.southLatitude
        && geometry.northLatitude <= bounds.northLatitude;
  }
}

export function datasetCoversGeometry(
  dataset: AtmosphericDatasetId,
  geometry: AtmosphericCoverageGeometry,
): boolean {
  return spatialDomainCoversGeometry(
    ATMOSPHERIC_DATASET_CATALOG[dataset].spatialDomain,
    geometry,
  );
}

export function datasetSupportsRunSelector(
  dataset: AtmosphericDatasetId,
  selector: AtmosphericRunSelectorId,
): boolean {
  return ATMOSPHERIC_DATASET_CATALOG[dataset].runSelectors.includes(selector);
}

export function datasetSupportsOperation(
  dataset: AtmosphericDatasetId,
  operation: AtmosphericOperationId,
): boolean {
  return ATMOSPHERIC_DATASET_CATALOG[dataset].operations.includes(operation);
}

/**
 * Forecast-model vocabulary. Keep this list limited to operational forecast
 * models so callers that truly mean "forecast models" do not silently start
 * iterating historical analysis datasets.
 */
export const ATMOSPHERIC_MODEL_IDS = [
  "gfs_0p25",
  "gfs_0p50",
  "aigfs_0p25",
  "aigefs_0p25",
  "hgefs_0p25",
  "icon_d2_0p02",
  "icon_d2_eps_2p1km",
  "arome_0p01",
  "aifs_0p25",
  "aifs_ens_0p25",
  "gefs_0p50",
  "ifs_0p25",
  "ifs_ens_0p25",
] as const;
export type AtmosphericModelId = (typeof ATMOSPHERIC_MODEL_IDS)[number];
export type AtmosphericModelKind = AtmosphericDatasetKind;
export type AtmosphericModelDefinition = AtmosphericDatasetDefinition;
export const ATMOSPHERIC_MODEL_CATALOG: Record<AtmosphericModelId, AtmosphericDatasetDefinition> = {
  gfs_0p25: ATMOSPHERIC_DATASET_CATALOG.gfs_0p25,
  gfs_0p50: ATMOSPHERIC_DATASET_CATALOG.gfs_0p50,
  aigfs_0p25: ATMOSPHERIC_DATASET_CATALOG.aigfs_0p25,
  aigefs_0p25: ATMOSPHERIC_DATASET_CATALOG.aigefs_0p25,
  hgefs_0p25: ATMOSPHERIC_DATASET_CATALOG.hgefs_0p25,
  icon_d2_0p02: ATMOSPHERIC_DATASET_CATALOG.icon_d2_0p02,
  icon_d2_eps_2p1km: ATMOSPHERIC_DATASET_CATALOG.icon_d2_eps_2p1km,
  arome_0p01: ATMOSPHERIC_DATASET_CATALOG.arome_0p01,
  aifs_0p25: ATMOSPHERIC_DATASET_CATALOG.aifs_0p25,
  aifs_ens_0p25: ATMOSPHERIC_DATASET_CATALOG.aifs_ens_0p25,
  gefs_0p50: ATMOSPHERIC_DATASET_CATALOG.gefs_0p50,
  ifs_0p25: ATMOSPHERIC_DATASET_CATALOG.ifs_0p25,
  ifs_ens_0p25: ATMOSPHERIC_DATASET_CATALOG.ifs_ens_0p25,
};

export function modelSupportsOperation(
  model: AtmosphericModelId,
  operation: AtmosphericOperationId,
): boolean {
  return ATMOSPHERIC_MODEL_CATALOG[model].operations.includes(operation);
}
