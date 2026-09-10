import { expandRequestedNonIsobaricFields } from "../catalog/non-isobaric-fields.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import type {
  NonIsobaricFieldId,
  ProfileSourceId,
  VariableId,
} from "../schema/query.js";

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
    : expandRequestedVariables(selection.variables).length * selection.pressureLevelsHpa.length;
  const fieldMessages = expandRequestedNonIsobaricFields(selection.fields).length;
  return pressureMessages + fieldMessages;
}

export function selectAutomaticGfsPointSource(selection: GfsPointSelection): ProfileSourceId {
  return estimateGfsPointMessagesPerStep(selection) > MAX_AUTO_S3_POINT_MESSAGES_PER_STEP
    ? "nomads"
    : "s3";
}
