import type { GfsCode, VariableOutput } from "./variables.js";

export const NON_ISOBARIC_FIELD_IDS = [
  "surface_pressure",
  "surface_geopotential_height",
  "surface_temperature",
  "wind_gust",
  "surface_cape",
  "surface_cin",
  "boundary_layer_height",
  "temperature_2m",
  "relative_humidity_2m",
  "specific_humidity_2m",
  "dew_point_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
  "u_wind_20m",
  "v_wind_20m",
  "wind_20m",
  "u_wind_30m",
  "v_wind_30m",
  "wind_30m",
  "u_wind_40m",
  "v_wind_40m",
  "wind_40m",
  "u_wind_50m",
  "v_wind_50m",
  "wind_50m",
  "temperature_80m",
  "specific_humidity_80m",
  "pressure_80m",
  "u_wind_80m",
  "v_wind_80m",
  "wind_80m",
  "temperature_100m",
  "u_wind_100m",
  "v_wind_100m",
  "wind_100m",
  "total_precipitation",
] as const;

export type NonIsobaricFieldId = (typeof NON_ISOBARIC_FIELD_IDS)[number];
export type RawNonIsobaricFieldId = Exclude<
  NonIsobaricFieldId,
  "wind_10m" | "wind_20m" | "wind_30m" | "wind_40m" | "wind_50m" | "wind_80m" | "wind_100m"
>;

export type NonIsobaricLevel =
  | { type: "surface"; gribLevel: "surface"; nomadsLevel: "surface" }
  | { type: "height_above_ground_m"; heightM: number; gribLevel: string; nomadsLevel: string };

export type FieldTemporalSemantics = "instantaneous" | "accumulation";

export interface RawNonIsobaricFieldDefinition {
  id: RawNonIsobaricFieldId;
  kind: "raw";
  gfsCode: GfsCode;
  level: NonIsobaricLevel;
  temporalSemantics: FieldTemporalSemantics;
  sourceUnit: string;
  description: string;
  outputs: readonly [VariableOutput];
}

export interface DerivedNonIsobaricFieldDefinition {
  id: Extract<NonIsobaricFieldId, `wind_${number}m`>;
  kind: "derived";
  level: Extract<NonIsobaricLevel, { type: "height_above_ground_m" }>;
  temporalSemantics: "instantaneous";
  dependencies: readonly [RawNonIsobaricFieldId, RawNonIsobaricFieldId];
  description: string;
  outputs: readonly VariableOutput[];
}

export type NonIsobaricFieldDefinition =
  | RawNonIsobaricFieldDefinition
  | DerivedNonIsobaricFieldDefinition;

const surface = (): Extract<NonIsobaricLevel, { type: "surface" }> => ({
  type: "surface",
  gribLevel: "surface",
  nomadsLevel: "surface",
});

const aboveGround = (heightM: number): Extract<NonIsobaricLevel, { type: "height_above_ground_m" }> => ({
  type: "height_above_ground_m",
  heightM,
  gribLevel: `${heightM} m above ground`,
  nomadsLevel: `${heightM}_m_above_ground`,
});

function raw(
  id: RawNonIsobaricFieldId,
  gfsCode: GfsCode,
  level: NonIsobaricLevel,
  sourceUnit: string,
  description: string,
  field: string,
  outputUnit: string,
  outputDescription: string,
  temporalSemantics: FieldTemporalSemantics = "instantaneous",
): RawNonIsobaricFieldDefinition {
  return {
    id,
    kind: "raw",
    gfsCode,
    level,
    temporalSemantics,
    sourceUnit,
    description,
    outputs: [{ field, unit: outputUnit, description: outputDescription }],
  };
}

function wind(heightM: number): DerivedNonIsobaricFieldDefinition {
  const id = `wind_${heightM}m` as DerivedNonIsobaricFieldDefinition["id"];
  return {
    id,
    kind: "derived",
    level: aboveGround(heightM),
    temporalSemantics: "instantaneous",
    dependencies: [`u_wind_${heightM}m`, `v_wind_${heightM}m`] as DerivedNonIsobaricFieldDefinition["dependencies"],
    description: `Wind speed and meteorological direction at ${heightM} m above ground derived from U/V components`,
    outputs: [
      { field: "windSpeedMs", unit: "m/s", description: "Wind speed" },
      { field: "windDirectionDeg", unit: "degree", description: "Meteorological wind direction" },
    ],
  };
}

const definitions: NonIsobaricFieldDefinition[] = [
  raw("surface_pressure", "PRES", surface(), "Pa", "Atmospheric pressure at the model surface", "pressurePa", "Pa", "Surface pressure"),
  raw("surface_geopotential_height", "HGT", surface(), "gpm", "Geopotential height of the model surface", "geopotentialHeightGpm", "gpm", "Surface geopotential height"),
  raw("surface_temperature", "TMP", surface(), "K", "Temperature at the model surface", "temperatureC", "degC", "Surface temperature converted to degrees Celsius"),
  raw("wind_gust", "GUST", surface(), "m/s", "Surface wind gust", "windGustMs", "m/s", "Wind gust speed"),
  raw("surface_cape", "CAPE", surface(), "J/kg", "Surface-based convective available potential energy", "capeJkg", "J/kg", "Surface-based CAPE"),
  raw("surface_cin", "CIN", surface(), "J/kg", "Surface-based convective inhibition", "cinJkg", "J/kg", "Surface-based CIN"),
  raw("boundary_layer_height", "HPBL", surface(), "m", "Planetary boundary-layer height", "boundaryLayerHeightM", "m", "Planetary boundary-layer height"),

  raw("temperature_2m", "TMP", aboveGround(2), "K", "Air temperature at 2 m above ground", "temperatureC", "degC", "Air temperature converted to degrees Celsius"),
  raw("relative_humidity_2m", "RH", aboveGround(2), "%", "Relative humidity at 2 m above ground", "relativeHumidityPct", "%", "Relative humidity"),
  raw("specific_humidity_2m", "SPFH", aboveGround(2), "kg/kg", "Specific humidity at 2 m above ground", "specificHumidityKgKg", "kg/kg", "Specific humidity"),
  raw("dew_point_2m", "DPT", aboveGround(2), "K", "Dew-point temperature at 2 m above ground", "dewPointC", "degC", "Dew-point temperature converted to degrees Celsius"),

  ...[10, 20, 30, 40, 50].flatMap((heightM) => [
    raw(`u_wind_${heightM}m` as RawNonIsobaricFieldId, "UGRD", aboveGround(heightM), "m/s", `Eastward wind component at ${heightM} m above ground`, "uWindMs", "m/s", "Eastward wind component"),
    raw(`v_wind_${heightM}m` as RawNonIsobaricFieldId, "VGRD", aboveGround(heightM), "m/s", `Northward wind component at ${heightM} m above ground`, "vWindMs", "m/s", "Northward wind component"),
    wind(heightM),
  ]),

  raw("temperature_80m", "TMP", aboveGround(80), "K", "Air temperature at 80 m above ground", "temperatureC", "degC", "Air temperature converted to degrees Celsius"),
  raw("specific_humidity_80m", "SPFH", aboveGround(80), "kg/kg", "Specific humidity at 80 m above ground", "specificHumidityKgKg", "kg/kg", "Specific humidity"),
  raw("pressure_80m", "PRES", aboveGround(80), "Pa", "Atmospheric pressure at 80 m above ground", "pressurePa", "Pa", "Atmospheric pressure"),
  raw("u_wind_80m", "UGRD", aboveGround(80), "m/s", "Eastward wind component at 80 m above ground", "uWindMs", "m/s", "Eastward wind component"),
  raw("v_wind_80m", "VGRD", aboveGround(80), "m/s", "Northward wind component at 80 m above ground", "vWindMs", "m/s", "Northward wind component"),
  wind(80),

  raw("temperature_100m", "TMP", aboveGround(100), "K", "Air temperature at 100 m above ground", "temperatureC", "degC", "Air temperature converted to degrees Celsius"),
  raw("u_wind_100m", "UGRD", aboveGround(100), "m/s", "Eastward wind component at 100 m above ground", "uWindMs", "m/s", "Eastward wind component"),
  raw("v_wind_100m", "VGRD", aboveGround(100), "m/s", "Northward wind component at 100 m above ground", "vWindMs", "m/s", "Northward wind component"),
  wind(100),

  raw("total_precipitation", "APCP", surface(), "kg/m^2", "Total precipitation accumulated over the GFS message interval", "totalPrecipitationMm", "mm", "Liquid-water-equivalent precipitation depth", "accumulation"),
];

export const NON_ISOBARIC_FIELD_CATALOG = Object.fromEntries(
  definitions.map((definition) => [definition.id, definition]),
) as Record<NonIsobaricFieldId, NonIsobaricFieldDefinition>;

export function expandRequestedFields(ids: readonly NonIsobaricFieldId[]): RawNonIsobaricFieldDefinition[] {
  const rawIds = new Set<RawNonIsobaricFieldId>();
  for (const id of ids) {
    const definition = NON_ISOBARIC_FIELD_CATALOG[id];
    if (definition.kind === "raw") rawIds.add(definition.id);
    else for (const dependency of definition.dependencies) rawIds.add(dependency);
  }
  return [...rawIds].map((id) => NON_ISOBARIC_FIELD_CATALOG[id] as RawNonIsobaricFieldDefinition);
}
