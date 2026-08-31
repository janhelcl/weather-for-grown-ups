import {
  AIGFS_AREA_FIELD_IDS,
  AIGFS_FIELD_IDS,
  AIGFS_PRESSURE_LEVELS_HPA,
  AIGFS_PRESSURE_VARIABLE_IDS,
  expandAigfsRequestedVariables,
  isAigfsAreaField,
  isAigfsField,
  isAigfsPressureLevel,
  isAigfsPressureVariable,
} from "./aigfs.js";
import {
  AIGEFS_MEMBERS,
  type AigefsMember,
} from "./aigefs.js";
import {
  GEFS_MEMBERS,
  GEFS_PROFILE_VARIABLES,
  isSupportedGefsProfileSelection,
  type GefsMember,
  type GefsProfileVariableId,
} from "./gefs.js";
import type { VariableId } from "../schema/query.js";

export type HgefsPopulation = "gefs" | "aigefs";
export type HgefsMember =
  | `gefs:${GefsMember}`
  | `aigefs:${AigefsMember}`;

export const HGEFS_MEMBERS: readonly HgefsMember[] = [
  ...GEFS_MEMBERS.map((member) => `gefs:${member}` as HgefsMember),
  ...AIGEFS_MEMBERS.map((member) => `aigefs:${member}` as HgefsMember),
];

export const HGEFS_PRESSURE_VARIABLE_IDS = AIGFS_PRESSURE_VARIABLE_IDS;
export const HGEFS_PRESSURE_LEVELS_HPA = AIGFS_PRESSURE_LEVELS_HPA;
export const HGEFS_FIELD_IDS = AIGFS_FIELD_IDS;
export const HGEFS_AREA_FIELD_IDS = AIGFS_AREA_FIELD_IDS;

const HGEFS_MEMBER_SET = new Set<string>(HGEFS_MEMBERS);
const GEFS_PROFILE_VARIABLE_SET = new Set<string>(GEFS_PROFILE_VARIABLES);

export function isHgefsMember(value: string): value is HgefsMember {
  return HGEFS_MEMBER_SET.has(value);
}

export function sortHgefsMembers(members: readonly HgefsMember[]): HgefsMember[] {
  const index = new Map(HGEFS_MEMBERS.map((member, position) => [member, position]));
  return [...members].sort(
    (left, right) => (index.get(left) ?? 999) - (index.get(right) ?? 999),
  );
}

export function splitHgefsMember(member: HgefsMember): {
  population: HgefsPopulation;
  member: GefsMember | AigefsMember;
} {
  const separator = member.indexOf(":");
  const population = member.slice(0, separator) as HgefsPopulation;
  const sourceMember = member.slice(separator + 1) as GefsMember | AigefsMember;
  return { population, member: sourceMember };
}

export function splitHgefsMembers(members: readonly HgefsMember[]): {
  gefs: GefsMember[];
  aigefs: AigefsMember[];
} {
  const gefs: GefsMember[] = [];
  const aigefs: AigefsMember[] = [];
  for (const hybridMember of sortHgefsMembers(members)) {
    const parsed = splitHgefsMember(hybridMember);
    if (parsed.population === "gefs") gefs.push(parsed.member as GefsMember);
    else aigefs.push(parsed.member as AigefsMember);
  }
  return { gefs, aigefs };
}

export function hgefsMember(
  population: HgefsPopulation,
  member: GefsMember | AigefsMember,
): HgefsMember {
  const value = `${population}:${member}` as HgefsMember;
  if (!HGEFS_MEMBER_SET.has(value)) throw new Error(`Unknown HGEFS member: ${value}`);
  return value;
}

export function isSupportedHgefsPressureSelection(
  variable: string,
  pressureLevelHpa: number,
): boolean {
  if (!isAigfsPressureVariable(variable) || !isAigfsPressureLevel(pressureLevelHpa)) {
    return false;
  }
  if (variable === "wind") {
    return isSupportedGefsProfileSelection("u_wind", pressureLevelHpa)
      && isSupportedGefsProfileSelection("v_wind", pressureLevelHpa);
  }
  if (!GEFS_PROFILE_VARIABLE_SET.has(variable)) return false;
  return isSupportedGefsProfileSelection(
    variable as GefsProfileVariableId,
    pressureLevelHpa,
  );
}

export function gefsVariablesForHgefs(
  requested: readonly VariableId[],
): GefsProfileVariableId[] {
  const ids = new Set<GefsProfileVariableId>();
  for (const dependency of expandAigfsRequestedVariables(requested)) {
    if (GEFS_PROFILE_VARIABLE_SET.has(dependency.id)) {
      ids.add(dependency.id as GefsProfileVariableId);
    }
  }
  for (const variable of requested) {
    if (variable === "wind") continue;
    if (GEFS_PROFILE_VARIABLE_SET.has(variable)) {
      ids.add(variable as GefsProfileVariableId);
    }
  }
  return [...ids];
}

export {
  isAigfsAreaField as isHgefsAreaField,
  isAigfsField as isHgefsField,
  isAigfsPressureLevel as isHgefsPressureLevel,
  isAigfsPressureVariable as isHgefsPressureVariable,
};
