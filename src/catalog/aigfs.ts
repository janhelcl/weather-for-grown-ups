import {
  expandRequestedFields,
  type NonIsobaricFieldId,
  type RawNonIsobaricFieldDefinition,
} from "./non-isobaric-fields.js";
import {
  expandRequestedVariables,
  type RawVariableDefinition,
} from "./variables.js";
import type { VariableId } from "../schema/query.js";

export const AIGEFS_MEMBERS = [
  "000", "001", "002", "003", "004", "005", "006", "007", "008", "009",
  "010", "011", "012", "013", "014", "015", "016", "017", "018", "019",
  "020", "021", "022", "023", "024", "025", "026", "027", "028", "029",
  "030",
] as const;

export type AigefsMember = (typeof AIGEFS_MEMBERS)[number];

export const AIGFS_PRESSURE_LEVELS_HPA = [
  50,
  100,
  150,
  200,
  250,
  300,
  400,
  500,
  600,
  700,
  850,
  925,
  1000,
] as const;

export const AIGFS_RAW_PRESSURE_VARIABLE_IDS = [
  "temperature",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
] as const satisfies readonly VariableId[];

export const AIGFS_DERIVED_PRESSURE_VARIABLE_IDS = [
  "wind",
  "potential_temperature",
  "mixing_ratio",
  "virtual_temperature",
  "air_density",
  "wet_bulb_temperature",
  "equivalent_potential_temperature",
] as const satisfies readonly VariableId[];

export const AIGFS_PRESSURE_VARIABLE_IDS = [
  ...AIGFS_RAW_PRESSURE_VARIABLE_IDS,
  ...AIGFS_DERIVED_PRESSURE_VARIABLE_IDS,
] as const;

export const AIGFS_FIELD_IDS = [
  "temperature_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
  "mean_sea_level_pressure",
  "total_precipitation",
] as const satisfies readonly NonIsobaricFieldId[];

export const AIGFS_AREA_FIELD_IDS = [
  "temperature_2m",
  "u_wind_10m",
  "v_wind_10m",
  "mean_sea_level_pressure",
  "total_precipitation",
] as const satisfies readonly NonIsobaricFieldId[];

const pressureLevelSet = new Set<number>(AIGFS_PRESSURE_LEVELS_HPA);
const pressureVariableSet = new Set<string>(AIGFS_PRESSURE_VARIABLE_IDS);
const fieldSet = new Set<string>(AIGFS_FIELD_IDS);
const areaFieldSet = new Set<string>(AIGFS_AREA_FIELD_IDS);

export function isAigfsPressureLevel(value: number): boolean {
  return pressureLevelSet.has(value);
}

export function isAigfsPressureVariable(value: string): value is (typeof AIGFS_PRESSURE_VARIABLE_IDS)[number] {
  return pressureVariableSet.has(value);
}

export function isAigfsField(value: string): value is (typeof AIGFS_FIELD_IDS)[number] {
  return fieldSet.has(value);
}

export function isAigfsAreaField(value: string): value is (typeof AIGFS_AREA_FIELD_IDS)[number] {
  return areaFieldSet.has(value);
}

export function expandAigfsRequestedVariables(ids: readonly VariableId[]): RawVariableDefinition[] {
  const unsupported = ids.filter((id) => !isAigfsPressureVariable(id));
  if (unsupported.length > 0) {
    throw new Error(`AIGFS pressure variables not supported: ${unsupported.join(", ")}`);
  }
  return expandRequestedVariables([...ids]);
}

export function expandAigfsRequestedFields(
  ids: readonly NonIsobaricFieldId[],
): RawNonIsobaricFieldDefinition[] {
  const unsupported = ids.filter((id) => !isAigfsField(id));
  if (unsupported.length > 0) {
    throw new Error(`AIGFS fields not supported: ${unsupported.join(", ")}`);
  }
  return expandRequestedFields([...ids]);
}
