import { AIGEFS_MEMBERS, type AigefsMember } from "./aigefs.js";
import {
  AIGFS_FIELD_IDS,
  isAigfsPressureLevel,
  isAigfsPressureVariable,
} from "./aigfs.js";
import {
  GEFS_MEMBERS,
  isSupportedGefsProfileSelection,
  type GefsMember,
  type GefsProfileVariableId,
} from "./gefs.js";
import type { NonIsobaricFieldId } from "./non-isobaric-fields.js";
import type { VariableId } from "../schema/query.js";

export type HgefsPopulation = "gefs" | "aigefs";
export type HgefsMember =
  | `gefs:${GefsMember}`
  | `aigefs:${AigefsMember}`;

export const HGEFS_MEMBERS: readonly HgefsMember[] = [
  ...GEFS_MEMBERS.map((member) => `gefs:${member}` as const),
  ...AIGEFS_MEMBERS.map((member) => `aigefs:${member}` as const),
];

export const HGEFS_PRESSURE_VARIABLE_IDS = [
  "temperature",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
  "potential_temperature",
  "mixing_ratio",
  "virtual_temperature",
  "air_density",
  "wet_bulb_temperature",
  "equivalent_potential_temperature",
] as const satisfies readonly VariableId[];

export type HgefsPressureVariableId = (typeof HGEFS_PRESSURE_VARIABLE_IDS)[number];

export const HGEFS_FIELD_IDS = [
  "temperature_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
  "mean_sea_level_pressure",
  "total_precipitation",
] as const satisfies readonly NonIsobaricFieldId[];

export type HgefsFieldId = (typeof HGEFS_FIELD_IDS)[number];

const MEMBER_INDEX = new Map<string, number>(
  HGEFS_MEMBERS.map((member, index) => [member, index]),
);
const PRESSURE_VARIABLE_SET = new Set<string>(HGEFS_PRESSURE_VARIABLE_IDS);
const FIELD_SET = new Set<string>(HGEFS_FIELD_IDS);

export function isHgefsMember(value: string): value is HgefsMember {
  return MEMBER_INDEX.has(value);
}

export function isHgefsPressureVariable(value: string): value is HgefsPressureVariableId {
  return PRESSURE_VARIABLE_SET.has(value);
}

export function isHgefsField(value: string): value is HgefsFieldId {
  return FIELD_SET.has(value);
}

export function isSupportedHgefsPressureSelection(
  variable: string,
  pressureLevelHpa: number,
): boolean {
  return isHgefsPressureVariable(variable)
    && isAigfsPressureVariable(variable)
    && isAigfsPressureLevel(pressureLevelHpa)
    && isSupportedGefsProfileSelection(
      variable as GefsProfileVariableId,
      pressureLevelHpa,
    );
}

export function sortHgefsMembers(members: readonly HgefsMember[]): HgefsMember[] {
  return [...members].sort(
    (left, right) => (MEMBER_INDEX.get(left) ?? 999) - (MEMBER_INDEX.get(right) ?? 999),
  );
}

export interface HgefsMemberSelection {
  members: HgefsMember[];
  gefs: GefsMember[];
  aigefs: AigefsMember[];
}

export function splitHgefsMembers(
  input: readonly string[] | undefined,
): HgefsMemberSelection {
  const raw = input ?? HGEFS_MEMBERS;
  const unsupported = raw.filter((member) => !isHgefsMember(member));
  if (unsupported.length > 0) {
    throw new Error(
      `HGEFS members must be namespaced as gefs:c00,p01..p30 or aigefs:c00,p01..p30; unsupported: ${unsupported.join(", ")}`,
    );
  }

  const members = sortHgefsMembers(raw as HgefsMember[]);
  const gefs = members
    .filter((member): member is `gefs:${GefsMember}` => member.startsWith("gefs:"))
    .map((member) => member.slice("gefs:".length) as GefsMember);
  const aigefs = members
    .filter((member): member is `aigefs:${AigefsMember}` => member.startsWith("aigefs:"))
    .map((member) => member.slice("aigefs:".length) as AigefsMember);

  if (gefs.length < 2 || aigefs.length < 2) {
    throw new Error(
      "HGEFS hybrid selections require at least two GEFS and two AIGEFS members; use dataset=gefs or dataset=aigefs for homogeneous subsets",
    );
  }

  return { members, gefs, aigefs };
}

export function hgefsPublicMember(
  population: HgefsPopulation,
  member: GefsMember | AigefsMember,
): HgefsMember {
  return `${population}:${member}` as HgefsMember;
}
