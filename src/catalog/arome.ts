import {
  expandRequestedFields,
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricFieldDefinition,
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
  "wind_gust",
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

export const AROME_WIND_GUST_FIELD: RawNonIsobaricFieldDefinition = {
  ...(NON_ISOBARIC_FIELD_CATALOG.wind_gust as RawNonIsobaricFieldDefinition),
  level: {
    type: "height_above_ground_m",
    heightM: 10,
    gribLevel: "10 m above ground",
    nomadsLevel: "10_m_above_ground",
  },
  temporalSemantics: "maximum",
  description: "Maximum 10 m wind gust over the preceding one-hour AROME post-processing interval",
};

export function aromeFieldDefinition(id: NonIsobaricFieldId): NonIsobaricFieldDefinition {
  return id === "wind_gust"
    ? AROME_WIND_GUST_FIELD
    : NON_ISOBARIC_FIELD_CATALOG[id];
}

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
  return expandRequestedFields(ids).map((field) =>
    field.id === "wind_gust" ? AROME_WIND_GUST_FIELD : field);
}
