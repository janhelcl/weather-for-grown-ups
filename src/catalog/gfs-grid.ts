export const GFS_GRID_IDS = ["0p25", "0p50"] as const;
export type GfsGrid = (typeof GFS_GRID_IDS)[number];

export const OPERATIONAL_GFS_MODEL_IDS = ["gfs_0p25", "gfs_0p50"] as const;
export const ARCHIVED_GFS_MODEL_IDS = [
  "gfs_0p25_forecast_archive",
  "gfs_grid4_forecast_0p5_archive",
] as const;

export type OperationalGfsModelId = (typeof OPERATIONAL_GFS_MODEL_IDS)[number];
export type ArchivedGfsModelId = (typeof ARCHIVED_GFS_MODEL_IDS)[number];

export function operationalGfsModelId(grid: GfsGrid): OperationalGfsModelId {
  return grid === "0p50" ? "gfs_0p50" : "gfs_0p25";
}

export function gfsGridSpacingDegrees(grid: GfsGrid): number {
  return grid === "0p50" ? 0.5 : 0.25;
}

export function archivedGfsModelId(grid: GfsGrid): ArchivedGfsModelId {
  return grid === "0p50"
    ? "gfs_grid4_forecast_0p5_archive"
    : "gfs_0p25_forecast_archive";
}
