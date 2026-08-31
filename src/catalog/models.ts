export const ATMOSPHERIC_DATASET_IDS = [
  "gfs_0p25",
  "gfs_0p50",
  "aigfs_0p25",
  "aigefs_0p25",
  "hgefs_0p25",
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
export type AtmosphericProvider = "noaa" | "ecmwf";

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
  family: "gfs" | "gefs" | "ifs" | "aigfs" | "aigefs" | "hgefs" | "aifs";
  provider: AtmosphericProvider;
  modelClass: AtmosphericModelClass;
  kind: AtmosphericDatasetKind;
  role: AtmosphericDatasetRole;
  horizontalGridDegrees: number;
  maxForecastHour?: number;
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
    maxForecastHour: 384,
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
    maxForecastHour: 384,
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
    maxForecastHour: 384,
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
    maxForecastHour: 384,
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
    maxForecastHour: 240,
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
  aifs_0p25: {
    id: "aifs_0p25",
    family: "aifs",
    provider: "ecmwf",
    modelClass: "ai",
    kind: "deterministic",
    role: "forecast",
    horizontalGridDegrees: 0.25,
    maxForecastHour: 360,
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
    maxForecastHour: 360,
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
    maxForecastHour: 384,
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
    maxForecastHour: 240,
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
    maxForecastHour: 360,
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
