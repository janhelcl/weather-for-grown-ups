import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";

/** Selection shape used by deterministic and historical dataset-native schemas. */
export function sparseSelection(request: QueryAtmosphereRequest) {
  return {
    ...(request.selection.variables === undefined ? {} : { variables: request.selection.variables }),
    ...(request.selection.pressureLevelsHpa === undefined
      ? {}
      : { pressureLevelsHpa: request.selection.pressureLevelsHpa }),
    ...(request.selection.fields === undefined ? {} : { fields: request.selection.fields }),
  };
}

/** Selection shape used by ensemble bundle schemas, where every axis is explicit. */
export function ensembleSelection(request: QueryAtmosphereRequest) {
  return {
    variables: request.selection.variables ?? [],
    pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
    fields: request.selection.fields ?? [],
  };
}

export function ensembleOptions(request: QueryAtmosphereRequest) {
  return {
    ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
    ...(request.ensemble?.quantiles === undefined ? {} : { quantiles: request.ensemble.quantiles }),
    ...(request.ensemble?.includeMembers === undefined
      ? {}
      : { includeMembers: request.ensemble.includeMembers }),
  };
}

export function areaScalarSelection(request: QueryAtmosphereRequest) {
  if ((request.selection.fields?.length ?? 0) === 1) {
    return { field: request.selection.fields![0] };
  }
  return {
    variable: request.selection.variables![0],
    pressureLevelHpa: request.selection.pressureLevelsHpa![0],
  };
}

export function boundingBox(request: QueryAtmosphereRequest) {
  if (request.geometry.type !== "area") {
    throw new Error("Internal routing error: expected area geometry");
  }
  return {
    westLongitude: request.geometry.westLongitude,
    eastLongitude: request.geometry.eastLongitude,
    southLatitude: request.geometry.southLatitude,
    northLatitude: request.geometry.northLatitude,
  };
}
