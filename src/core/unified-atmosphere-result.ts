import { ARCHIVED_GFS_FORECAST_MODEL } from "./archived-gfs-query.js";
import {
  publicDatasetMetadata,
  unifiedAtmosphereResultSchema,
  type DiagnoseAtmosphereRequest,
  type QueryAtmosphereRequest,
  type UnifiedAtmosphereResult,
} from "../schema/unified-api.js";

export function wrapUnifiedAtmosphereResult(
  request: QueryAtmosphereRequest | DiagnoseAtmosphereRequest,
  result: unknown,
): UnifiedAtmosphereResult {
  const metadata = publicDatasetMetadata(request.dataset);
  const internalDatasetId = request.forecast?.kind === "reforecast"
    ? "gefs_v12_reforecast"
    : isArchivedGfsForecastResult(result)
      ? (result as { model: "gfs_0p25_forecast_archive" | "gfs_grid4_forecast_0p5_archive" }).model
      : isOperationalGfsResult(result)
        ? (result as { model: "gfs_0p25" | "gfs_0p50" }).model
        : isGefsReforecastResult(result)
          ? "gefs_v12_reforecast"
          : metadata.internalDatasetId;

  return unifiedAtmosphereResultSchema.parse({
    dataset: request.dataset,
    internalDatasetId,
    role: metadata.role,
    kind: metadata.kind,
    geometryType: request.geometry.type,
    timeType: "at" in request.time ? "instant" : "range",
    result,
  });
}

function isOperationalGfsResult(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "model" in result
    && ((result as { model?: unknown }).model === "gfs_0p25"
      || (result as { model?: unknown }).model === "gfs_0p50");
}

function isArchivedGfsForecastResult(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "model" in result
    && (
      (result as { model?: unknown }).model === ARCHIVED_GFS_FORECAST_MODEL
      || (result as { model?: unknown }).model === "gfs_0p25_forecast_archive"
    );
}

function isGefsReforecastResult(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "model" in result
    && (result as { model?: unknown }).model === "gefs_v12_reforecast";
}
