export const ATMOSPHERIC_MODEL_IDS = ["gfs_0p25", "gefs_0p50"] as const;

export type AtmosphericModelId = (typeof ATMOSPHERIC_MODEL_IDS)[number];
export type AtmosphericModelKind = "deterministic" | "ensemble";

export const ATMOSPHERIC_OPERATION_IDS = [
  "profile",
  "timeseries",
  "layer_diagnostics",
  "profile_diagnostics",
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

export interface AtmosphericModelDefinition {
  id: AtmosphericModelId;
  family: "gfs" | "gefs";
  kind: AtmosphericModelKind;
  horizontalGridDegrees: number;
  maxForecastHour: number;
  members?: number;
  operations: readonly AtmosphericOperationId[];
}

export const ATMOSPHERIC_MODEL_CATALOG: Record<AtmosphericModelId, AtmosphericModelDefinition> = {
  gfs_0p25: {
    id: "gfs_0p25",
    family: "gfs",
    kind: "deterministic",
    horizontalGridDegrees: 0.25,
    maxForecastHour: 384,
    operations: [
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
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
    horizontalGridDegrees: 0.5,
    maxForecastHour: 384,
    members: 31,
    operations: [
      "profile",
      "timeseries",
      "ensemble_distribution",
      "aligned_model_comparison",
    ],
  },
};

export function modelSupportsOperation(model: AtmosphericModelId, operation: AtmosphericOperationId): boolean {
  return ATMOSPHERIC_MODEL_CATALOG[model].operations.includes(operation);
}
