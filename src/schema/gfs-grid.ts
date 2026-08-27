import * as z from "zod/v4";

export const GFS_GRID_IDS = ["0p25", "0p50"] as const;
export const gfsGridSchema = z.enum(GFS_GRID_IDS).default("0p25");
export type GfsGrid = z.output<typeof gfsGridSchema>;

export const OPERATIONAL_GFS_MODEL_IDS = ["gfs_0p25", "gfs_0p50"] as const;
export const ARCHIVED_GFS_MODEL_IDS = [
  "gfs_0p25_forecast_archive",
  "gfs_grid4_forecast_0p5_archive",
] as const;
export const operationalGfsModelIdSchema = z.enum(OPERATIONAL_GFS_MODEL_IDS);
export type OperationalGfsModelId = z.output<typeof operationalGfsModelIdSchema>;

export function operationalGfsModelId(grid: GfsGrid): OperationalGfsModelId {
  return grid === "0p50" ? "gfs_0p50" : "gfs_0p25";
}

export function gfsGridSpacingDegrees(grid: GfsGrid): number {
  return grid === "0p50" ? 0.5 : 0.25;
}

export type ArchivedGfsModelId = (typeof ARCHIVED_GFS_MODEL_IDS)[number];

export function archivedGfsModelId(grid: GfsGrid): ArchivedGfsModelId {
  return grid === "0p50"
    ? "gfs_grid4_forecast_0p5_archive"
    : "gfs_0p25_forecast_archive";
}
