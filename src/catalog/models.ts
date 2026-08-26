export const ATMOSPHERIC_DATASET_IDS = [
  "gfs_0p25",
  "gefs_0p50",
  "gfs_grid4_analysis_0p5",
] as const;

export type AtmosphericDatasetId = (typeof ATMOSPHERIC_DATASET_IDS)[number];
export type AtmosphericDatasetKind = "deterministic" | "ensemble";
export type AtmosphericDatasetRole = "forecast" | "analysis";

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
  family: "gfs" | "gefs";
  kind: AtmosphericDatasetKind;
  role: AtmosphericDatasetRole;
  horizontalGridDegrees: number;
  maxForecastHour?: number;
  members?: number;
  operations: readonly AtmosphericOperationId[];
}

export const ATMOSPHERIC_DATASET_CATALOG: Record<AtmosphericDatasetId, AtmosphericDatasetDefinition> = {
  gfs_0p25: {
    id: "gfs_0p25",
    family: "gfs",
    kind: "deterministic",
    role: "forecast",
    horizontalGridDegrees: 0.25,
    maxForecastHour: 384,
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
  gefs_0p50: {
    id: "gefs_0p50",
    family: "gefs",
    kind: "ensemble",
    role: "forecast",
    horizontalGridDegrees: 0.5,
    maxForecastHour: 384,
    members: 31,
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
    kind: "deterministic",
    role: "analysis",
    horizontalGridDegrees: 0.5,
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

export function datasetSupportsOperation(
  dataset: AtmosphericDatasetId,
  operation: AtmosphericOperationId,
): boolean {
  return ATMOSPHERIC_DATASET_CATALOG[dataset].operations.includes(operation);
}

/**
 * Backward-compatible forecast-model vocabulary. Keep this list limited to the
 * original operational models so callers that truly mean "forecast models" do
 * not silently start iterating historical analysis datasets.
 */
export const ATMOSPHERIC_MODEL_IDS = ["gfs_0p25", "gefs_0p50"] as const;
export type AtmosphericModelId = (typeof ATMOSPHERIC_MODEL_IDS)[number];
export type AtmosphericModelKind = AtmosphericDatasetKind;
export type AtmosphericModelDefinition = AtmosphericDatasetDefinition;
export const ATMOSPHERIC_MODEL_CATALOG: Record<AtmosphericModelId, AtmosphericDatasetDefinition> = {
  gfs_0p25: ATMOSPHERIC_DATASET_CATALOG.gfs_0p25,
  gefs_0p50: ATMOSPHERIC_DATASET_CATALOG.gefs_0p50,
};

export function modelSupportsOperation(
  model: AtmosphericModelId,
  operation: AtmosphericOperationId,
): boolean {
  return ATMOSPHERIC_MODEL_CATALOG[model].operations.includes(operation);
}
