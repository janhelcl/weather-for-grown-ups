import * as z from "zod/v4";
import { GFS_GRID_IDS, OPERATIONAL_GFS_MODEL_IDS } from "../catalog/gfs-grid.js";

export {
  ARCHIVED_GFS_MODEL_IDS,
  GFS_GRID_IDS,
  OPERATIONAL_GFS_MODEL_IDS,
  archivedGfsModelId,
  gfsGridSpacingDegrees,
  operationalGfsModelId,
} from "../catalog/gfs-grid.js";
export type {
  ArchivedGfsModelId,
  GfsGrid,
  OperationalGfsModelId,
} from "../catalog/gfs-grid.js";

export const gfsGridSchema = z.enum(GFS_GRID_IDS);
export const gfsGridWithDefaultSchema = gfsGridSchema.default("0p25");
export const operationalGfsModelIdSchema = z.enum(OPERATIONAL_GFS_MODEL_IDS);
