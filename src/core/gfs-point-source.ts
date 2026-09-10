import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { expandRequestedFields } from "../catalog/non-isobaric-fields.js";
import { PARCEL_DIAGNOSTIC_CATALOG } from "../catalog/parcel-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import type {
  NonIsobaricFieldId,
  ProfileSourceId,
  VariableId,
} from "../schema/query.js";
import type { DiagnoseAtmosphereRequest } from "../schema/unified-api.js";

/**
 * S3 byte ranges remove unrequested GRIB messages but each retained message is
 * still a full global grid. Above this width, decoding those grids locally is
 * slower than asking NOMADS for the same messages spatially subset around the
 * requested point.
 *
 * This is a transport-performance threshold, not a public query limit.
 */
export const MAX_AUTO_S3_POINT_MESSAGES_PER_STEP = 16;

export interface GfsPointSelection {
  variables?: readonly VariableId[] | undefined;
  pressureLevelsHpa?: readonly number[] | undefined;
  fields?: readonly NonIsobaricFieldId[] | undefined;
}

export function estimateGfsPointMessagesPerStep(selection: GfsPointSelection): number {
  const pressureMessages = selection.variables === undefined
    || selection.pressureLevelsHpa === undefined
    ? 0
    : expandRequestedVariables([...selection.variables]).length * selection.pressureLevelsHpa.length;
  const fieldMessages = expandRequestedFields([...(selection.fields ?? [])]).length;
  return pressureMessages + fieldMessages;
}

export function selectAutomaticGfsPointSource(selection: GfsPointSelection): ProfileSourceId {
  return estimateGfsPointMessagesPerStep(selection) > MAX_AUTO_S3_POINT_MESSAGES_PER_STEP
    ? "nomads"
    : "s3";
}

export function selectAutomaticGfsDiagnosticSource(
  diagnostic: DiagnoseAtmosphereRequest["diagnostic"],
): ProfileSourceId {
  if (diagnostic.kind === "layer") {
    return selectAutomaticGfsPointSource({
      variables: expandLayerDiagnosticVariables(diagnostic.diagnostics),
      pressureLevelsHpa: [diagnostic.lowerPressureHpa, diagnostic.upperPressureHpa],
    });
  }

  if (diagnostic.kind === "profile") {
    return selectAutomaticGfsPointSource({
      variables: expandProfileDiagnosticVariables(diagnostic.diagnostics),
      pressureLevelsHpa: diagnostic.pressureLevelsHpa,
    });
  }

  const definition = PARCEL_DIAGNOSTIC_CATALOG[diagnostic.parcel];
  return selectAutomaticGfsPointSource({
    variables: definition.pressureDependencies,
    pressureLevelsHpa: diagnostic.pressureLevelsHpa,
    fields: definition.fieldDependencies,
  });
}
