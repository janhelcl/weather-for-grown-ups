import type { NonIsobaricFieldId } from "./non-isobaric-fields.js";
import {
  ICON_D2_AREA_FIELD_IDS,
  ICON_D2_AREA_PRESSURE_VARIABLE_IDS,
  ICON_D2_DERIVED_PRESSURE_VARIABLE_IDS,
  ICON_D2_FIELD_IDS,
  ICON_D2_PRESSURE_LEVELS_HPA,
  ICON_D2_PRESSURE_VARIABLE_IDS,
  ICON_D2_RAW_PRESSURE_VARIABLE_IDS,
  expandIconD2RequestedFields,
  expandIconD2RequestedVariables,
  isIconD2PressureLevel,
  isIconD2PressureVariable,
} from "./icon-d2.js";

export const ICON_D2_EPS_MEMBERS = [
  "p01", "p02", "p03", "p04", "p05",
  "p06", "p07", "p08", "p09", "p10",
  "p11", "p12", "p13", "p14", "p15",
  "p16", "p17", "p18", "p19", "p20",
] as const;

export type IconD2EpsMember = (typeof ICON_D2_EPS_MEMBERS)[number];

export {
  ICON_D2_AREA_FIELD_IDS as ICON_D2_EPS_AREA_FIELD_IDS,
  ICON_D2_AREA_PRESSURE_VARIABLE_IDS as ICON_D2_EPS_AREA_PRESSURE_VARIABLE_IDS,
  ICON_D2_DERIVED_PRESSURE_VARIABLE_IDS as ICON_D2_EPS_DERIVED_PRESSURE_VARIABLE_IDS,
  ICON_D2_PRESSURE_LEVELS_HPA as ICON_D2_EPS_PRESSURE_LEVELS_HPA,
  ICON_D2_PRESSURE_VARIABLE_IDS as ICON_D2_EPS_PRESSURE_VARIABLE_IDS,
  ICON_D2_RAW_PRESSURE_VARIABLE_IDS as ICON_D2_EPS_RAW_PRESSURE_VARIABLE_IDS,
  expandIconD2RequestedVariables as expandIconD2EpsRequestedVariables,
  isIconD2PressureLevel as isIconD2EpsPressureLevel,
  isIconD2PressureVariable as isIconD2EpsPressureVariable,
};

export const ICON_D2_EPS_FIELD_IDS = ICON_D2_FIELD_IDS.filter(
  (id) => id !== "dry_convection_top_height_msl",
) satisfies readonly NonIsobaricFieldId[];

const ICON_D2_EPS_FIELD_SET = new Set<string>(ICON_D2_EPS_FIELD_IDS);

export function isIconD2EpsField(
  value: string,
): value is (typeof ICON_D2_EPS_FIELD_IDS)[number] {
  return ICON_D2_EPS_FIELD_SET.has(value);
}

export function expandIconD2EpsRequestedFields(
  ids: readonly NonIsobaricFieldId[],
) {
  const unsupported = ids.filter((id) => !isIconD2EpsField(id));
  if (unsupported.length > 0) {
    throw new Error(`ICON-D2-EPS fields not supported: ${unsupported.join(", ")}`);
  }
  return expandIconD2RequestedFields(ids);
}

const MEMBER_INDEX = new Map<string, number>(
  ICON_D2_EPS_MEMBERS.map((member, index) => [member, index]),
);

export function sortIconD2EpsMembers(
  members: readonly IconD2EpsMember[],
): IconD2EpsMember[] {
  return [...members].sort(
    (left, right) => (MEMBER_INDEX.get(left) ?? 999) - (MEMBER_INDEX.get(right) ?? 999),
  );
}

export function iconD2EpsMemberOrdinal(member: IconD2EpsMember): number {
  const index = MEMBER_INDEX.get(member);
  if (index === undefined) throw new Error(`Unknown ICON-D2-EPS member: ${member}`);
  return index + 1;
}
