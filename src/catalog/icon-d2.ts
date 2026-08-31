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

/**
 * Pressure levels published by DWD's ICON-D2 pressure-level Open Data product.
 * Keep this inventory explicit rather than inheriting a broader global-model list.
 */
export const ICON_D2_PRESSURE_LEVELS_HPA = [
  300,
  400,
  500,
  600,
  700,
  800,
  850,
  900,
  925,
  950,
  1000,
] as const;

export const ICON_D2_RAW_PRESSURE_VARIABLE_IDS = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "vertical_velocity",
] as const satisfies readonly VariableId[];

export const ICON_D2_DERIVED_PRESSURE_VARIABLE_IDS = [
  "wind",
  "dew_point",
  "potential_temperature",
] as const satisfies readonly VariableId[];

export const ICON_D2_PRESSURE_VARIABLE_IDS = [
  ...ICON_D2_RAW_PRESSURE_VARIABLE_IDS,
  ...ICON_D2_DERIVED_PRESSURE_VARIABLE_IDS,
] as const;

export const ICON_D2_FIELD_IDS = [
  "temperature_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
  "mean_sea_level_pressure",
  "total_precipitation",
] as const satisfies readonly NonIsobaricFieldId[];

export const ICON_D2_AREA_PRESSURE_VARIABLE_IDS = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "vertical_velocity",
] as const satisfies readonly VariableId[];

export const ICON_D2_AREA_FIELD_IDS = [
  "temperature_2m",
  "u_wind_10m",
  "v_wind_10m",
  "mean_sea_level_pressure",
  "total_precipitation",
] as const satisfies readonly NonIsobaricFieldId[];

const pressureLevelSet = new Set<number>(ICON_D2_PRESSURE_LEVELS_HPA);
const pressureVariableSet = new Set<string>(ICON_D2_PRESSURE_VARIABLE_IDS);
const fieldSet = new Set<string>(ICON_D2_FIELD_IDS);

export function isIconD2PressureLevel(value: number): boolean {
  return pressureLevelSet.has(value);
}

export function isIconD2PressureVariable(
  value: string,
): value is (typeof ICON_D2_PRESSURE_VARIABLE_IDS)[number] {
  return pressureVariableSet.has(value);
}

export function isIconD2Field(
  value: string,
): value is (typeof ICON_D2_FIELD_IDS)[number] {
  return fieldSet.has(value);
}

export function expandIconD2RequestedVariables(
  ids: readonly VariableId[],
): RawVariableDefinition[] {
  const unsupported = ids.filter((id) => !isIconD2PressureVariable(id));
  if (unsupported.length > 0) {
    throw new Error(`ICON-D2 pressure variables not supported: ${unsupported.join(", ")}`);
  }
  return expandRequestedVariables([...ids]);
}

export function expandIconD2RequestedFields(
  ids: readonly NonIsobaricFieldId[],
): RawNonIsobaricFieldDefinition[] {
  const unsupported = ids.filter((id) => !isIconD2Field(id));
  if (unsupported.length > 0) {
    throw new Error(`ICON-D2 fields not supported: ${unsupported.join(", ")}`);
  }
  return expandRequestedFields([...ids]);
}
