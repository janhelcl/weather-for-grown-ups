import {
  expandRequestedFields,
  type NonIsobaricFieldId,
  type RawNonIsobaricFieldDefinition,
} from "./non-isobaric-fields.js";

/**
 * The public 0.01° EURW1S100 AROME package is deliberately treated as its own
 * product. It exposes a compact near-surface/low-level inventory and must not
 * be silently mixed with the separate, pressure-richer 0.025° package.
 */
export const AROME_0P01_FIELD_IDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
  "u_wind_20m",
  "v_wind_20m",
  "wind_20m",
  "u_wind_50m",
  "v_wind_50m",
  "wind_50m",
  "u_wind_100m",
  "v_wind_100m",
  "wind_100m",
] as const satisfies readonly NonIsobaricFieldId[];

export const AROME_0P01_AREA_FIELD_IDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "u_wind_10m",
  "v_wind_10m",
  "u_wind_20m",
  "v_wind_20m",
  "u_wind_50m",
  "v_wind_50m",
  "u_wind_100m",
  "v_wind_100m",
] as const satisfies readonly NonIsobaricFieldId[];

const fieldSet = new Set<string>(AROME_0P01_FIELD_IDS);
const areaFieldSet = new Set<string>(AROME_0P01_AREA_FIELD_IDS);

export function isArome0p01Field(id: string): id is (typeof AROME_0P01_FIELD_IDS)[number] {
  return fieldSet.has(id);
}

export function isArome0p01AreaField(
  id: string,
): id is (typeof AROME_0P01_AREA_FIELD_IDS)[number] {
  return areaFieldSet.has(id);
}

export function expandArome0p01RequestedFields(
  ids: readonly NonIsobaricFieldId[],
): RawNonIsobaricFieldDefinition[] {
  return expandRequestedFields(ids);
}
