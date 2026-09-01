import {
  expandRequestedFields,
  type NonIsobaricFieldId,
  type RawNonIsobaricFieldDefinition,
} from "./non-isobaric-fields.js";

export const PE_AROME_MEMBERS = [
  "c00",
  "p01", "p02", "p03", "p04", "p05", "p06",
  "p07", "p08", "p09", "p10", "p11", "p12",
  "p13", "p14", "p15", "p16", "p17", "p18",
  "p19", "p20", "p21", "p22", "p23", "p24",
] as const;

export type PeAromeMember = (typeof PE_AROME_MEMBERS)[number];

export const PE_AROME_FIELD_IDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
] as const satisfies readonly NonIsobaricFieldId[];

export const PE_AROME_AREA_FIELD_IDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "u_wind_10m",
  "v_wind_10m",
] as const satisfies readonly NonIsobaricFieldId[];

const memberSet = new Set<string>(PE_AROME_MEMBERS);
const fieldSet = new Set<string>(PE_AROME_FIELD_IDS);

export function isPeAromeMember(value: string): value is PeAromeMember {
  return memberSet.has(value);
}

export function peAromeMemberNumber(member: PeAromeMember): number {
  return member === "c00" ? 0 : Number(member.slice(1));
}

export function sortPeAromeMembers(members: readonly PeAromeMember[]): PeAromeMember[] {
  return [...members].sort((left, right) => peAromeMemberNumber(left) - peAromeMemberNumber(right));
}

export function isPeAromeField(
  value: string,
): value is (typeof PE_AROME_FIELD_IDS)[number] {
  return fieldSet.has(value);
}

export function expandPeAromeRequestedFields(
  ids: readonly NonIsobaricFieldId[],
): RawNonIsobaricFieldDefinition[] {
  const unsupported = ids.filter((id) => !isPeAromeField(id));
  if (unsupported.length > 0) {
    throw new Error(`PE-AROME fields not supported: ${unsupported.join(", ")}`);
  }
  return expandRequestedFields([...ids]);
}
