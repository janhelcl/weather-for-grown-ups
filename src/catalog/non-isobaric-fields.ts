import type { GfsCode, VariableOutput } from "./variables.js";

export const NON_ISOBARIC_FIELD_IDS = [
  "surface_pressure",
  "surface_geopotential_height",
  "surface_temperature",
  "mean_sea_level_pressure",
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
  "column_maximum_reflectivity",
  "precipitable_water",
  "total_column_cloud_water",
  "column_relative_humidity",
  "total_column_ozone",
  "low_cloud_cover",
  "low_cloud_cover_average",
  "middle_cloud_cover",
  "middle_cloud_cover_average",
  "high_cloud_cover",
  "high_cloud_cover_average",
  "total_atmosphere_cloud_cover",
  "total_atmosphere_cloud_cover_average",
  "cloud_ceiling_height",
  "convective_cloud_base_pressure",
  "low_cloud_base_pressure",
  "middle_cloud_base_pressure",
  "high_cloud_base_pressure",
  "convective_cloud_top_pressure",
  "low_cloud_top_pressure",
  "middle_cloud_top_pressure",
  "high_cloud_top_pressure",
  "low_cloud_top_temperature",
  "middle_cloud_top_temperature",
  "high_cloud_top_temperature",
  "convective_cloud_cover",
  "boundary_layer_cloud_cover",
  "cloud_work_function",
] as const;

export type NonIsobaricFieldId = (typeof NON_ISOBARIC_FIELD_IDS)[number];
export type RawNonIsobaricFieldId = Exclude<
  NonIsobaricFieldId,
  "wind_10m" | "wind_20m" | "wind_30m" | "wind_40m" | "wind_50m" | "wind_80m" | "wind_100m"
>;

export const NON_ISOBARIC_NAMED_LAYER_IDS = [
  "entire_atmosphere",
  "entire_atmosphere_single_layer",
  "low_cloud_layer",
  "middle_cloud_layer",
  "high_cloud_layer",
  "convective_cloud_layer",
  "boundary_layer_cloud_layer",
] as const;

export const NON_ISOBARIC_NAMED_LEVEL_IDS = [
  "mean_sea_level",
  "cloud_ceiling",
  "convective_cloud_base",
  "low_cloud_base",
  "middle_cloud_base",
  "high_cloud_base",
  "convective_cloud_top",
  "low_cloud_top",
  "middle_cloud_top",
  "high_cloud_top",
] as const;

export type NonIsobaricNamedLayerId = (typeof NON_ISOBARIC_NAMED_LAYER_IDS)[number];
export type NonIsobaricNamedLevelId = (typeof NON_ISOBARIC_NAMED_LEVEL_IDS)[number];

export type NonIsobaricLevel =
  | { type: "surface"; gribLevel: "surface"; nomadsLevel: "surface" }
  | { type: "height_above_ground_m"; heightM: number; gribLevel: string; nomadsLevel: string }
  | { type: "named_layer"; id: NonIsobaricNamedLayerId; gribLevel: string; nomadsLevel: string }
  | { type: "named_level"; id: NonIsobaricNamedLevelId; gribLevel: string; nomadsLevel: string };

export type NamedNonIsobaricLevel = Extract<
  NonIsobaricLevel,
  { type: "named_layer" | "named_level" }
>;

export type FieldTemporalSemantics = "instantaneous" | "accumulation" | "average" | "maximum";
export type NonIsobaricGribCode = GfsCode | "BREF";

export interface RawNonIsobaricFieldDefinition {
  id: RawNonIsobaricFieldId;
  kind: "raw";
  gfsCode: NonIsobaricGribCode;
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

const namedLayer = (
  id: NonIsobaricNamedLayerId,
  gribLevel: string,
  nomadsLevel: string,
): Extract<NonIsobaricLevel, { type: "named_layer" }> => ({
  type: "named_layer",
  id,
  gribLevel,
  nomadsLevel,
});

const namedLevel = (
  id: NonIsobaricNamedLevelId,
  gribLevel: string,
  nomadsLevel: string,
): Extract<NonIsobaricLevel, { type: "named_level" }> => ({
  type: "named_level",
  id,
  gribLevel,
  nomadsLevel,
});

const namedLevels = {
  entireAtmosphere: namedLayer("entire_atmosphere", "entire atmosphere", "entire_atmosphere"),
  entireAtmosphereSingleLayer: namedLayer(
    "entire_atmosphere_single_layer",
    "entire atmosphere (considered as a single layer)",
    "entire_atmosphere_(considered_as_a_single_layer)",
  ),
  lowCloudLayer: namedLayer("low_cloud_layer", "low cloud layer", "low_cloud_layer"),
  middleCloudLayer: namedLayer("middle_cloud_layer", "middle cloud layer", "middle_cloud_layer"),
  highCloudLayer: namedLayer("high_cloud_layer", "high cloud layer", "high_cloud_layer"),
  convectiveCloudLayer: namedLayer("convective_cloud_layer", "convective cloud layer", "convective_cloud_layer"),
  boundaryLayerCloudLayer: namedLayer(
    "boundary_layer_cloud_layer",
    "boundary layer cloud layer",
    "boundary_layer_cloud_layer",
  ),
  meanSeaLevel: namedLevel("mean_sea_level", "mean sea level", "mean_sea_level"),
  cloudCeiling: namedLevel("cloud_ceiling", "cloud ceiling", "cloud_ceiling"),
  convectiveCloudBase: namedLevel(
    "convective_cloud_base",
    "convective cloud bottom level",
    "convective_cloud_bottom_level",
  ),
  lowCloudBase: namedLevel("low_cloud_base", "low cloud bottom level", "low_cloud_bottom_level"),
  middleCloudBase: namedLevel("middle_cloud_base", "middle cloud bottom level", "middle_cloud_bottom_level"),
  highCloudBase: namedLevel("high_cloud_base", "high cloud bottom level", "high_cloud_bottom_level"),
  convectiveCloudTop: namedLevel("convective_cloud_top", "convective cloud top level", "convective_cloud_top_level"),
  lowCloudTop: namedLevel("low_cloud_top", "low cloud top level", "low_cloud_top_level"),
  middleCloudTop: namedLevel("middle_cloud_top", "middle cloud top level", "middle_cloud_top_level"),
  highCloudTop: namedLevel("high_cloud_top", "high cloud top level", "high_cloud_top_level"),
} as const;

const allNamedLevels: NamedNonIsobaricLevel[] = Object.values(namedLevels);

export function findNamedNonIsobaricLevel(gribLevel: string): NamedNonIsobaricLevel | undefined {
  return allNamedLevels.find((level) => level.gribLevel === gribLevel);
}

function raw(
  id: RawNonIsobaricFieldId,
  gfsCode: NonIsobaricGribCode,
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

function wind(heightM: 10 | 20 | 30 | 40 | 50 | 80 | 100): DerivedNonIsobaricFieldDefinition {
  const id = `wind_${heightM}m` as DerivedNonIsobaricFieldDefinition["id"];
  const uId = `u_wind_${heightM}m` as RawNonIsobaricFieldId;
  const vId = `v_wind_${heightM}m` as RawNonIsobaricFieldId;
  return {
    id,
    kind: "derived",
    level: aboveGround(heightM),
    temporalSemantics: "instantaneous",
    dependencies: [uId, vId],
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
  raw("mean_sea_level_pressure", "PRMSL", namedLevels.meanSeaLevel, "Pa", "Pressure reduced to mean sea level", "pressurePa", "Pa", "Mean sea-level pressure"),
  raw("wind_gust", "GUST", surface(), "m/s", "Surface wind gust", "windGustMs", "m/s", "Wind gust speed"),
  raw("surface_cape", "CAPE", surface(), "J/kg", "Surface-based convective available potential energy", "capeJkg", "J/kg", "Surface-based CAPE"),
  raw("surface_cin", "CIN", surface(), "J/kg", "Surface-based convective inhibition", "cinJkg", "J/kg", "Surface-based CIN"),
  raw("boundary_layer_height", "HPBL", surface(), "m", "Planetary boundary-layer height", "boundaryLayerHeightM", "m", "Planetary boundary-layer height"),

  raw("temperature_2m", "TMP", aboveGround(2), "K", "Air temperature at 2 m above ground", "temperatureC", "degC", "Air temperature converted to degrees Celsius"),
  raw("relative_humidity_2m", "RH", aboveGround(2), "%", "Relative humidity at 2 m above ground", "relativeHumidityPct", "%", "Relative humidity"),
  raw("specific_humidity_2m", "SPFH", aboveGround(2), "kg/kg", "Specific humidity at 2 m above ground", "specificHumidityKgKg", "kg/kg", "Specific humidity"),
  raw("dew_point_2m", "DPT", aboveGround(2), "K", "Dew-point temperature at 2 m above ground", "dewPointC", "degC", "Dew-point temperature converted to degrees Celsius"),

  ...([10, 20, 30, 40, 50] as const).flatMap((heightM) => [
    raw(`u_wind_${heightM}m`, "UGRD", aboveGround(heightM), "m/s", `Eastward wind component at ${heightM} m above ground`, "uWindMs", "m/s", "Eastward wind component"),
    raw(`v_wind_${heightM}m`, "VGRD", aboveGround(heightM), "m/s", `Northward wind component at ${heightM} m above ground`, "vWindMs", "m/s", "Northward wind component"),
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
  raw(
    "column_maximum_reflectivity",
    "BREF",
    namedLevels.entireAtmosphere,
    "mm^6/m^3",
    "Maximum simulated radar reflectivity factor anywhere in the atmospheric column",
    "columnMaximumReflectivityFactorMm6M3",
    "mm^6/m^3",
    "Column-maximum simulated radar reflectivity factor",
  ),

  raw("precipitable_water", "PWAT", namedLevels.entireAtmosphereSingleLayer, "kg/m^2", "Precipitable water for the entire atmospheric column", "precipitableWaterKgM2", "kg/m^2", "Precipitable water"),
  raw("total_column_cloud_water", "CWAT", namedLevels.entireAtmosphereSingleLayer, "kg/m^2", "Cloud water integrated over the atmospheric column", "cloudWaterKgM2", "kg/m^2", "Total column cloud water"),
  raw("column_relative_humidity", "RH", namedLevels.entireAtmosphereSingleLayer, "%", "GFS relative humidity diagnostic for the entire atmospheric column", "relativeHumidityPct", "%", "Column relative humidity"),
  raw("total_column_ozone", "TOZNE", namedLevels.entireAtmosphereSingleLayer, "DU", "Total ozone for the atmospheric column", "totalOzoneDobsonUnits", "DU", "Total column ozone"),

  raw("low_cloud_cover", "LCDC", namedLevels.lowCloudLayer, "%", "Instantaneous low cloud cover", "cloudCoverPct", "%", "Low cloud cover"),
  raw("low_cloud_cover_average", "LCDC", namedLevels.lowCloudLayer, "%", "Forecast-window mean low cloud cover", "cloudCoverPct", "%", "Mean low cloud cover", "average"),
  raw("middle_cloud_cover", "MCDC", namedLevels.middleCloudLayer, "%", "Instantaneous middle cloud cover", "cloudCoverPct", "%", "Middle cloud cover"),
  raw("middle_cloud_cover_average", "MCDC", namedLevels.middleCloudLayer, "%", "Forecast-window mean middle cloud cover", "cloudCoverPct", "%", "Mean middle cloud cover", "average"),
  raw("high_cloud_cover", "HCDC", namedLevels.highCloudLayer, "%", "Instantaneous high cloud cover", "cloudCoverPct", "%", "High cloud cover"),
  raw("high_cloud_cover_average", "HCDC", namedLevels.highCloudLayer, "%", "Forecast-window mean high cloud cover", "cloudCoverPct", "%", "Mean high cloud cover", "average"),
  raw("total_atmosphere_cloud_cover", "TCDC", namedLevels.entireAtmosphere, "%", "Instantaneous total cloud cover across the atmosphere", "cloudCoverPct", "%", "Total atmospheric cloud cover"),
  raw("total_atmosphere_cloud_cover_average", "TCDC", namedLevels.entireAtmosphere, "%", "Forecast-window mean total cloud cover across the atmosphere", "cloudCoverPct", "%", "Mean total atmospheric cloud cover", "average"),
  raw("cloud_ceiling_height", "HGT", namedLevels.cloudCeiling, "gpm", "Geopotential height of the cloud ceiling", "geopotentialHeightGpm", "gpm", "Cloud ceiling geopotential height"),

  raw("convective_cloud_base_pressure", "PRES", namedLevels.convectiveCloudBase, "Pa", "Pressure at the convective cloud base", "pressurePa", "Pa", "Convective cloud base pressure"),
  raw("low_cloud_base_pressure", "PRES", namedLevels.lowCloudBase, "Pa", "Forecast-window mean pressure at the low-cloud base", "pressurePa", "Pa", "Mean low-cloud base pressure", "average"),
  raw("middle_cloud_base_pressure", "PRES", namedLevels.middleCloudBase, "Pa", "Forecast-window mean pressure at the middle-cloud base", "pressurePa", "Pa", "Mean middle-cloud base pressure", "average"),
  raw("high_cloud_base_pressure", "PRES", namedLevels.highCloudBase, "Pa", "Forecast-window mean pressure at the high-cloud base", "pressurePa", "Pa", "Mean high-cloud base pressure", "average"),
  raw("convective_cloud_top_pressure", "PRES", namedLevels.convectiveCloudTop, "Pa", "Pressure at the convective cloud top", "pressurePa", "Pa", "Convective cloud top pressure"),
  raw("low_cloud_top_pressure", "PRES", namedLevels.lowCloudTop, "Pa", "Forecast-window mean pressure at the low-cloud top", "pressurePa", "Pa", "Mean low-cloud top pressure", "average"),
  raw("middle_cloud_top_pressure", "PRES", namedLevels.middleCloudTop, "Pa", "Forecast-window mean pressure at the middle-cloud top", "pressurePa", "Pa", "Mean middle-cloud top pressure", "average"),
  raw("high_cloud_top_pressure", "PRES", namedLevels.highCloudTop, "Pa", "Forecast-window mean pressure at the high-cloud top", "pressurePa", "Pa", "Mean high-cloud top pressure", "average"),
  raw("low_cloud_top_temperature", "TMP", namedLevels.lowCloudTop, "K", "Forecast-window mean temperature at the low-cloud top", "temperatureC", "degC", "Mean low-cloud top temperature converted to degrees Celsius", "average"),
  raw("middle_cloud_top_temperature", "TMP", namedLevels.middleCloudTop, "K", "Forecast-window mean temperature at the middle-cloud top", "temperatureC", "degC", "Mean middle-cloud top temperature converted to degrees Celsius", "average"),
  raw("high_cloud_top_temperature", "TMP", namedLevels.highCloudTop, "K", "Forecast-window mean temperature at the high-cloud top", "temperatureC", "degC", "Mean high-cloud top temperature converted to degrees Celsius", "average"),
  raw("convective_cloud_cover", "TCDC", namedLevels.convectiveCloudLayer, "%", "Instantaneous convective cloud cover", "cloudCoverPct", "%", "Convective cloud cover"),
  raw("boundary_layer_cloud_cover", "TCDC", namedLevels.boundaryLayerCloudLayer, "%", "Forecast-window mean boundary-layer cloud cover", "cloudCoverPct", "%", "Mean boundary-layer cloud cover", "average"),
  raw("cloud_work_function", "CWORK", namedLevels.entireAtmosphereSingleLayer, "J/kg", "Forecast-window mean cloud work function", "cloudWorkFunctionJkg", "J/kg", "Cloud work function", "average"),
];

export const NON_ISOBARIC_FIELD_CATALOG = Object.fromEntries(
  definitions.map((definition) => [definition.id, definition]),
) as Record<NonIsobaricFieldId, NonIsobaricFieldDefinition>;

export const REGIONAL_ONLY_NON_ISOBARIC_FIELD_IDS = [
  "column_maximum_reflectivity",
] as const satisfies readonly NonIsobaricFieldId[];

const regionalOnlyFieldSet = new Set<string>(REGIONAL_ONLY_NON_ISOBARIC_FIELD_IDS);

export function isGfsNonIsobaricField(id: string): id is NonIsobaricFieldId {
  return !regionalOnlyFieldSet.has(id) && id in NON_ISOBARIC_FIELD_CATALOG;
}

export const GFS_NON_ISOBARIC_FIELD_IDS = NON_ISOBARIC_FIELD_IDS.filter(
  (id) => isGfsNonIsobaricField(id),
);

export function expandRequestedFields(ids: readonly NonIsobaricFieldId[]): RawNonIsobaricFieldDefinition[] {
  const rawIds = new Set<RawNonIsobaricFieldId>();
  for (const id of ids) {
    const definition = NON_ISOBARIC_FIELD_CATALOG[id];
    if (definition.kind === "raw") rawIds.add(definition.id);
    else for (const dependency of definition.dependencies) rawIds.add(dependency);
  }
  return [...rawIds].map((id) => NON_ISOBARIC_FIELD_CATALOG[id] as RawNonIsobaricFieldDefinition);
}
