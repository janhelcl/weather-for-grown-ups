import type { RawVariableId, VariableId } from "../schema/query.js";

export const GEFS_MEMBERS = [
  "c00",
  "p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10",
  "p11", "p12", "p13", "p14", "p15", "p16", "p17", "p18", "p19", "p20",
  "p21", "p22", "p23", "p24", "p25", "p26", "p27", "p28", "p29", "p30",
] as const;

export type GefsMember = (typeof GEFS_MEMBERS)[number];

export const GEFS_PGRB2A_PRESSURE_VARIABLES = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
] as const satisfies readonly RawVariableId[];

export type GefsPressureVariableId = (typeof GEFS_PGRB2A_PRESSURE_VARIABLES)[number];

export const GEFS_DERIVED_PROFILE_VARIABLES = [
  "dew_point",
  "potential_temperature",
] as const satisfies readonly VariableId[];

export type GefsDerivedProfileVariableId = (typeof GEFS_DERIVED_PROFILE_VARIABLES)[number];
export type GefsProfileVariableId = GefsPressureVariableId | GefsDerivedProfileVariableId;

export const GEFS_PROFILE_VARIABLES = [
  ...GEFS_PGRB2A_PRESSURE_VARIABLES,
  ...GEFS_DERIVED_PROFILE_VARIABLES,
] as const satisfies readonly VariableId[];

export const GEFS_PGRB2A_COMMON_PRESSURE_LEVELS_HPA = [
  10, 50, 100, 200, 250, 500, 700, 850, 925, 1000,
] as const;

export const GEFS_PGRB2A_WIND_EXTRA_PRESSURE_LEVELS_HPA = [300, 400] as const;

const COMMON_LEVELS = new Set<number>(GEFS_PGRB2A_COMMON_PRESSURE_LEVELS_HPA);
const WIND_EXTRA_LEVELS = new Set<number>(GEFS_PGRB2A_WIND_EXTRA_PRESSURE_LEVELS_HPA);
const MEMBER_INDEX = new Map<string, number>(GEFS_MEMBERS.map((member, index) => [member, index]));

export function isSupportedGefsPressureSelection(
  variable: GefsPressureVariableId,
  pressureLevelHpa: number,
): boolean {
  if (COMMON_LEVELS.has(pressureLevelHpa)) return true;
  return (variable === "u_wind" || variable === "v_wind") && WIND_EXTRA_LEVELS.has(pressureLevelHpa);
}

export function gefsProfileRawDependencies(variable: GefsProfileVariableId): GefsPressureVariableId[] {
  switch (variable) {
    case "dew_point": return ["temperature", "relative_humidity"];
    case "potential_temperature": return ["temperature"];
    default: return [variable];
  }
}

export function isSupportedGefsProfileSelection(
  variable: GefsProfileVariableId,
  pressureLevelHpa: number,
): boolean {
  return gefsProfileRawDependencies(variable)
    .every((dependency) => isSupportedGefsPressureSelection(dependency, pressureLevelHpa));
}

export function sortGefsMembers(members: readonly GefsMember[]): GefsMember[] {
  return [...members].sort((a, b) => (MEMBER_INDEX.get(a) ?? 999) - (MEMBER_INDEX.get(b) ?? 999));
}
