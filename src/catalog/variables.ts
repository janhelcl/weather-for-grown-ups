import type { VariableId } from "../schema/query.js";

export const SUPPORTED_GFS_CODES = [
  "TMP",
  "RH",
  "UGRD",
  "VGRD",
  "HGT",
  "SPFH",
  "VVEL",
  "DZDT",
  "ABSV",
  "TCDC",
  "CLWMR",
  "O3MR",
] as const;

export const ALL_SUPPORTED_GFS_CODES = [
  ...SUPPORTED_GFS_CODES,
  "PRES",
  "GUST",
  "CAPE",
  "CIN",
  "HPBL",
  "DPT",
  "APCP",
  "PWAT",
  "CWAT",
  "TOZNE",
  "LCDC",
  "MCDC",
  "HCDC",
  "CWORK",
] as const;

export type GfsCode = (typeof ALL_SUPPORTED_GFS_CODES)[number];
export type RawVariableId = Exclude<VariableId, "wind">;

export interface VariableOutput {
  field: string;
  unit: string;
  description: string;
}

export interface RawVariableDefinition {
  id: RawVariableId;
  kind: "raw";
  levelType: "isobaric_hpa";
  gfsCode: GfsCode;
  sourceUnit: string;
  description: string;
  outputs: readonly [VariableOutput];
}

export interface DerivedVariableDefinition {
  id: "wind";
  kind: "derived";
  levelType: "isobaric_hpa";
  dependencies: readonly ["u_wind", "v_wind"];
  description: string;
  outputs: readonly VariableOutput[];
}

export type VariableDefinition = RawVariableDefinition | DerivedVariableDefinition;

export const VARIABLE_CATALOG: Record<VariableId, VariableDefinition> = {
  temperature: raw("temperature", "TMP", "K", "Air temperature", "temperatureC", "degC", "Air temperature converted to degrees Celsius"),
  relative_humidity: raw("relative_humidity", "RH", "%", "Relative humidity", "relativeHumidityPct", "%", "Relative humidity"),
  u_wind: raw("u_wind", "UGRD", "m/s", "Eastward wind component", "uWindMs", "m/s", "Eastward wind component"),
  v_wind: raw("v_wind", "VGRD", "m/s", "Northward wind component", "vWindMs", "m/s", "Northward wind component"),
  geopotential_height: raw("geopotential_height", "HGT", "gpm", "Geopotential height", "geopotentialHeightGpm", "gpm", "Geopotential height"),
  specific_humidity: raw("specific_humidity", "SPFH", "kg/kg", "Specific humidity", "specificHumidityKgKg", "kg/kg", "Specific humidity"),
  vertical_velocity: raw("vertical_velocity", "VVEL", "Pa/s", "Vertical velocity in pressure coordinates", "verticalVelocityPaS", "Pa/s", "Pressure-coordinate vertical velocity"),
  geometric_vertical_velocity: raw("geometric_vertical_velocity", "DZDT", "m/s", "Vertical velocity in geometric coordinates", "geometricVerticalVelocityMs", "m/s", "Geometric vertical velocity"),
  absolute_vorticity: raw("absolute_vorticity", "ABSV", "1/s", "Absolute vorticity", "absoluteVorticityS1", "1/s", "Absolute vorticity"),
  total_cloud_cover: raw("total_cloud_cover", "TCDC", "%", "Total cloud cover on an isobaric surface", "totalCloudCoverPct", "%", "Total cloud cover"),
  cloud_water_mixing_ratio: raw("cloud_water_mixing_ratio", "CLWMR", "kg/kg", "Cloud water mixing ratio", "cloudWaterMixingRatioKgKg", "kg/kg", "Cloud water mixing ratio"),
  ozone_mixing_ratio: raw("ozone_mixing_ratio", "O3MR", "kg/kg", "Ozone mixing ratio", "ozoneMixingRatioKgKg", "kg/kg", "Ozone mixing ratio"),
  wind: {
    id: "wind",
    kind: "derived",
    levelType: "isobaric_hpa",
    dependencies: ["u_wind", "v_wind"],
    description: "Wind speed and meteorological direction derived from U/V components",
    outputs: [
      { field: "windSpeedMs", unit: "m/s", description: "Wind speed" },
      { field: "windDirectionDeg", unit: "degree", description: "Meteorological wind direction" },
    ],
  },
};

export function expandRequestedVariables(ids: VariableId[]): RawVariableDefinition[] {
  const rawIds = new Set<RawVariableId>();

  for (const id of ids) {
    const definition = VARIABLE_CATALOG[id];
    if (definition.kind === "raw") {
      rawIds.add(definition.id);
    } else {
      for (const dependency of definition.dependencies) rawIds.add(dependency);
    }
  }

  return [...rawIds].map((id) => VARIABLE_CATALOG[id] as RawVariableDefinition);
}

function raw(
  id: RawVariableId,
  gfsCode: GfsCode,
  sourceUnit: string,
  description: string,
  field: string,
  outputUnit: string,
  outputDescription: string,
): RawVariableDefinition {
  return {
    id,
    kind: "raw",
    levelType: "isobaric_hpa",
    gfsCode,
    sourceUnit,
    description,
    outputs: [{ field, unit: outputUnit, description: outputDescription }],
  };
}
