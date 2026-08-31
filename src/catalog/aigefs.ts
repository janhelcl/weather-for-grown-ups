import {
  AIGFS_AREA_FIELD_IDS,
  AIGFS_DERIVED_PRESSURE_VARIABLE_IDS,
  AIGFS_FIELD_IDS,
  AIGFS_PRESSURE_LEVELS_HPA,
  AIGFS_PRESSURE_VARIABLE_IDS,
  AIGFS_RAW_PRESSURE_VARIABLE_IDS,
  expandAigfsRequestedFields,
  expandAigfsRequestedVariables,
  isAigfsAreaField,
  isAigfsField,
  isAigfsPressureLevel,
  isAigfsPressureVariable,
} from "./aigfs.js";

export const AIGEFS_MEMBERS = [
  "c00",
  "p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10",
  "p11", "p12", "p13", "p14", "p15", "p16", "p17", "p18", "p19", "p20",
  "p21", "p22", "p23", "p24", "p25", "p26", "p27", "p28", "p29", "p30",
] as const;

export type AigefsMember = (typeof AIGEFS_MEMBERS)[number];

export {
  AIGFS_AREA_FIELD_IDS as AIGEFS_AREA_FIELD_IDS,
  AIGFS_DERIVED_PRESSURE_VARIABLE_IDS as AIGEFS_DERIVED_PRESSURE_VARIABLE_IDS,
  AIGFS_FIELD_IDS as AIGEFS_FIELD_IDS,
  AIGFS_PRESSURE_LEVELS_HPA as AIGEFS_PRESSURE_LEVELS_HPA,
  AIGFS_PRESSURE_VARIABLE_IDS as AIGEFS_PRESSURE_VARIABLE_IDS,
  AIGFS_RAW_PRESSURE_VARIABLE_IDS as AIGEFS_RAW_PRESSURE_VARIABLE_IDS,
  expandAigfsRequestedFields as expandAigefsRequestedFields,
  expandAigfsRequestedVariables as expandAigefsRequestedVariables,
  isAigfsAreaField as isAigefsAreaField,
  isAigfsField as isAigefsField,
  isAigfsPressureLevel as isAigefsPressureLevel,
  isAigfsPressureVariable as isAigefsPressureVariable,
};

const MEMBER_INDEX = new Map<string, number>(
  AIGEFS_MEMBERS.map((member, index) => [member, index]),
);

export function sortAigefsMembers(members: readonly AigefsMember[]): AigefsMember[] {
  return [...members].sort(
    (left, right) => (MEMBER_INDEX.get(left) ?? 999) - (MEMBER_INDEX.get(right) ?? 999),
  );
}

export function aigefsSourceMember(member: AigefsMember): string {
  const index = MEMBER_INDEX.get(member);
  if (index === undefined) throw new Error(`Unknown AIGEFS member: ${member}`);
  return `mem${String(index).padStart(3, "0")}`;
}
