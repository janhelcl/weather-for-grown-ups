import { ATMOSPHERIC_DATASET_CATALOG, type AtmosphericDatasetId } from "../catalog/models.js";
import { InvalidRequestError } from "../failure.js";
import { publicDatasetMetadata, type QueryAtmosphereRequest } from "../schema/unified-api.js";
import { DEFAULT_TRANSECT_SAMPLES } from "../schema/transect.js";

export const DEFAULT_MAX_ATMOSPHERIC_POINT_STEPS = 5_000;
const HOUR_MS = 3_600_000;

/**
 * Bound the number of point/profile retrievals a unified atmospheric request
 * can fan out into before any provider access starts.
 *
 * This intentionally measures geometry × time only. Selection width is made
 * memory-stable by message-at-a-time point decoding; area/grid operations have
 * their own grid-point limits.
 */
export function assertAtmosphericQueryWithinBudget(request: QueryAtmosphereRequest): void {
  if (request.geometry.type === "area") return;

  const spatialSamples = atmosphericSpatialSamples(request);
  const timeSteps = atmosphericTimeStepsUpperBound(request);
  const requestedPointSteps = spatialSamples * timeSteps;
  const maxPointSteps = request.limits?.maxPointSteps ?? DEFAULT_MAX_ATMOSPHERIC_POINT_STEPS;
  if (requestedPointSteps <= maxPointSteps) return;

  throw new InvalidRequestError(
    `Atmospheric query exceeds the point-step safety limit: ${requestedPointSteps} > ${maxPointSteps} (${spatialSamples} spatial samples × ${timeSteps} time steps). Reduce the number of points/transect samples, narrow the time range, or set time.maxSteps to a smaller value.`,
    {
      details: {
        limitingDimension: "point_steps",
        requestedPointSteps,
        maxPointSteps,
        spatialSamples,
        timeSteps,
        repair: {
          reduce: ["geometry points/transect samples", "time range", "time.maxSteps"],
        },
      },
    },
  );
}

function atmosphericSpatialSamples(request: QueryAtmosphereRequest): number {
  switch (request.geometry.type) {
    case "point": return 1;
    case "points": return request.geometry.points.length;
    case "transect": return request.geometry.samples ?? DEFAULT_TRANSECT_SAMPLES;
    case "area": return 0;
  }
}

function atmosphericTimeStepsUpperBound(request: QueryAtmosphereRequest): number {
  if ("at" in request.time) return 1;

  const startMs = new Date(request.time.from).getTime();
  const endMs = new Date(request.time.to).getTime();
  const cadenceHours = minimumNativeCadenceHours(request);
  const cadenceUpperBound = Math.floor((endMs - startMs) / (cadenceHours * HOUR_MS)) + 1;
  return request.time.maxSteps === undefined
    ? cadenceUpperBound
    : Math.min(cadenceUpperBound, request.time.maxSteps);
}

function minimumNativeCadenceHours(request: QueryAtmosphereRequest): number {
  const internalDatasetId: AtmosphericDatasetId = request.dataset === "gfs"
    && request.forecast?.grid === "0p50"
    ? "gfs_0p50"
    : publicDatasetMetadata(request.dataset).internalDatasetId;
  const cadence = ATMOSPHERIC_DATASET_CATALOG[internalDatasetId].nativeTimeCadenceHours;
  return Math.min(...cadence);
}
