import type { GfsCode, VariableOutput } from "./variables.js";

export const GEFS_PGRB2A_FIELD_IDS = [
  "surface_pressure",
  "temperature_2m",
  "relative_humidity_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
  "total_precipitation",
  "precipitable_water",
  "total_atmosphere_cloud_cover",
  "cape_180mb",
  "cin_180mb",
  "mean_sea_level_pressure",
] as const;

export type GefsPgrb2aFieldId = (typeof GEFS_PGRB2A_FIELD_IDS)[number];
export type RawGefsPgrb2aFieldId = Exclude<GefsPgrb2aFieldId, "wind_10m">;

export type GefsFieldTemporalSemantics = "instantaneous" | "accumulation" | "average";

export interface GefsFieldLevel {
  gribLevel: string;
  description: string;
}

export interface RawGefsFieldDefinition {
  id: RawGefsPgrb2aFieldId;
  kind: "raw";
  gfsCode: GfsCode;
  level: GefsFieldLevel;
  temporalSemantics: GefsFieldTemporalSemantics;
  sourceUnit: string;
  description: string;
  outputs: readonly [VariableOutput];
}

export interface DerivedGefsFieldDefinition {
  id: "wind_10m";
  kind: "derived";
  level: GefsFieldLevel;
  temporalSemantics: "instantaneous";
  dependencies: readonly ["u_wind_10m", "v_wind_10m"];
  description: string;
  outputs: readonly VariableOutput[];
}

export type GefsFieldDefinition = RawGefsFieldDefinition | DerivedGefsFieldDefinition;

const surface = { gribLevel: "surface", description: "model surface" } as const;
const twoMeters = { gribLevel: "2 m above ground", description: "2 m above ground" } as const;
const tenMeters = { gribLevel: "10 m above ground", description: "10 m above ground" } as const;
const wholeAtmosphere = { gribLevel: "entire atmosphere", description: "entire atmosphere" } as const;
const wholeAtmosphereSingleLayer = {
  gribLevel: "entire atmosphere (considered as a single layer)",
  description: "entire atmosphere considered as one layer",
} as const;
const capeLayer = { gribLevel: "180-0 mb above ground", description: "180-0 hPa above ground layer" } as const;
const meanSeaLevel = { gribLevel: "mean sea level", description: "mean sea level" } as const;

function raw(
  id: RawGefsPgrb2aFieldId,
  gfsCode: GfsCode,
  level: GefsFieldLevel,
  sourceUnit: string,
  description: string,
  field: string,
  unit: string,
  outputDescription: string,
  temporalSemantics: GefsFieldTemporalSemantics = "instantaneous",
): RawGefsFieldDefinition {
  return {
    id,
    kind: "raw",
    gfsCode,
    level,
    temporalSemantics,
    sourceUnit,
    description,
    outputs: [{ field, unit, description: outputDescription }],
  };
}

const definitions: GefsFieldDefinition[] = [
  raw("surface_pressure", "PRES", surface, "Pa", "Atmospheric pressure at the model surface", "pressurePa", "Pa", "Surface pressure"),
  raw("temperature_2m", "TMP", twoMeters, "K", "Air temperature at 2 m above ground", "temperatureC", "degC", "Air temperature converted to degrees Celsius"),
  raw("relative_humidity_2m", "RH", twoMeters, "%", "Relative humidity at 2 m above ground", "relativeHumidityPct", "%", "Relative humidity"),
  raw("u_wind_10m", "UGRD", tenMeters, "m/s", "Eastward wind component at 10 m above ground", "uWindMs", "m/s", "Eastward wind component"),
  raw("v_wind_10m", "VGRD", tenMeters, "m/s", "Northward wind component at 10 m above ground", "vWindMs", "m/s", "Northward wind component"),
  {
    id: "wind_10m",
    kind: "derived",
    level: tenMeters,
    temporalSemantics: "instantaneous",
    dependencies: ["u_wind_10m", "v_wind_10m"],
    description: "10 m wind speed and meteorological direction derived independently for each GEFS member",
    outputs: [
      { field: "windSpeedMs", unit: "m/s", description: "Wind speed" },
      { field: "windDirectionDeg", unit: "degree", description: "Meteorological wind direction" },
    ],
  },
  raw("total_precipitation", "APCP", surface, "kg/m^2", "Liquid-water-equivalent precipitation accumulated over the GEFS message interval", "totalPrecipitationMm", "mm", "Liquid-water-equivalent precipitation depth", "accumulation"),
  raw("precipitable_water", "PWAT", wholeAtmosphereSingleLayer, "kg/m^2", "Precipitable water for the atmospheric column", "precipitableWaterKgM2", "kg/m^2", "Precipitable water"),
  raw("total_atmosphere_cloud_cover", "TCDC", wholeAtmosphere, "%", "Total cloud cover averaged over the GEFS message interval", "cloudCoverPct", "%", "Total atmospheric cloud cover", "average"),
  raw("cape_180mb", "CAPE", capeLayer, "J/kg", "Convective available potential energy for the 180-0 hPa above-ground layer published by GEFS pgrb2a", "capeJkg", "J/kg", "CAPE"),
  raw("cin_180mb", "CIN", capeLayer, "J/kg", "Convective inhibition for the 180-0 hPa above-ground layer published by GEFS pgrb2a", "cinJkg", "J/kg", "CIN"),
  raw("mean_sea_level_pressure", "PRMSL", meanSeaLevel, "Pa", "Pressure reduced to mean sea level", "pressurePa", "Pa", "Mean sea-level pressure"),
];

export const GEFS_PGRB2A_FIELD_CATALOG: Record<GefsPgrb2aFieldId, GefsFieldDefinition> =
  Object.fromEntries(definitions.map((definition) => [definition.id, definition])) as Record<GefsPgrb2aFieldId, GefsFieldDefinition>;

export function rawGefsFieldDefinitions(ids: readonly GefsPgrb2aFieldId[]): RawGefsFieldDefinition[] {
  const expanded = ids.flatMap((id) => {
    const definition = GEFS_PGRB2A_FIELD_CATALOG[id];
    if (definition.kind === "raw") return [definition];
    return definition.dependencies.map((dependency) => GEFS_PGRB2A_FIELD_CATALOG[dependency] as RawGefsFieldDefinition);
  });
  return [...new Map(expanded.map((definition) => [definition.id, definition])).values()];
}
