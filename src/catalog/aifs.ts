import { NON_ISOBARIC_FIELD_CATALOG } from "./non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "./variables.js";
import type { NonIsobaricFieldId } from "./non-isobaric-fields.js";
import type { VariableId } from "../schema/query.js";

export const AIFS_PRESSURE_LEVELS_HPA = [
  1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10,
] as const;

export const AIFS_RAW_PRESSURE_VARIABLE_IDS = [
  "temperature",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
] as const satisfies readonly VariableId[];

export const AIFS_DERIVED_PRESSURE_VARIABLE_IDS = [
  "wind",
  "potential_temperature",
  "mixing_ratio",
  "virtual_temperature",
  "air_density",
  "wet_bulb_temperature",
  "equivalent_potential_temperature",
] as const satisfies readonly VariableId[];

export const AIFS_PRESSURE_VARIABLE_IDS = [
  ...AIFS_RAW_PRESSURE_VARIABLE_IDS,
  ...AIFS_DERIVED_PRESSURE_VARIABLE_IDS,
] as const;

export type AifsRawPressureVariableId = (typeof AIFS_RAW_PRESSURE_VARIABLE_IDS)[number];
export type AifsPressureVariableId = (typeof AIFS_PRESSURE_VARIABLE_IDS)[number];

export interface AifsRawPressureVariableDefinition {
  id: AifsRawPressureVariableId;
  param: string;
  sourceUnit: string;
}

export const AIFS_RAW_PRESSURE_VARIABLE_CATALOG: Record<
  AifsRawPressureVariableId,
  AifsRawPressureVariableDefinition
> = {
  temperature: { id: "temperature", param: "t", sourceUnit: "K" },
  u_wind: { id: "u_wind", param: "u", sourceUnit: "m/s" },
  v_wind: { id: "v_wind", param: "v", sourceUnit: "m/s" },
  geopotential_height: { id: "geopotential_height", param: "z", sourceUnit: "m^2/s^2" },
  specific_humidity: { id: "specific_humidity", param: "q", sourceUnit: "kg/kg" },
  vertical_velocity: { id: "vertical_velocity", param: "w", sourceUnit: "Pa/s" },
};

export const AIFS_RAW_FIELD_IDS = [
  "surface_pressure",
  "surface_geopotential_height",
  "mean_sea_level_pressure",
  "temperature_2m",
  "dew_point_2m",
  "u_wind_10m",
  "v_wind_10m",
  "u_wind_100m",
  "v_wind_100m",
  "total_precipitation",
  "low_cloud_cover",
  "middle_cloud_cover",
  "high_cloud_cover",
  "total_atmosphere_cloud_cover",
] as const satisfies readonly NonIsobaricFieldId[];

export const AIFS_DERIVED_FIELD_IDS = [
  "relative_humidity_2m",
  "specific_humidity_2m",
  "wind_10m",
  "wind_100m",
] as const satisfies readonly NonIsobaricFieldId[];

export const AIFS_FIELD_IDS = [
  ...AIFS_RAW_FIELD_IDS,
  ...AIFS_DERIVED_FIELD_IDS,
] as const;

export const AIFS_AREA_FIELD_IDS = AIFS_RAW_FIELD_IDS;

export type AifsRawFieldId = (typeof AIFS_RAW_FIELD_IDS)[number];
export type AifsFieldId = (typeof AIFS_FIELD_IDS)[number];

export interface AifsRawFieldDefinition {
  id: AifsRawFieldId;
  kind: "raw";
  param: string;
  sourceUnit: string;
  temporalSemantics: "instantaneous" | "accumulation";
}

export interface AifsDerivedFieldDefinition {
  id: (typeof AIFS_DERIVED_FIELD_IDS)[number];
  kind: "derived";
  dependencies: readonly AifsRawFieldId[];
  temporalSemantics: "instantaneous";
}

export type AifsFieldDefinition = AifsRawFieldDefinition | AifsDerivedFieldDefinition;

export const AIFS_FIELD_CATALOG: Record<AifsFieldId, AifsFieldDefinition> = {
  surface_pressure: rawField("surface_pressure", "sp", "Pa"),
  surface_geopotential_height: rawField("surface_geopotential_height", "z", "m^2/s^2"),
  mean_sea_level_pressure: rawField("mean_sea_level_pressure", "msl", "Pa"),
  temperature_2m: rawField("temperature_2m", "2t", "K"),
  dew_point_2m: rawField("dew_point_2m", "2d", "K"),
  relative_humidity_2m: {
    id: "relative_humidity_2m",
    kind: "derived",
    dependencies: ["temperature_2m", "dew_point_2m"],
    temporalSemantics: "instantaneous",
  },
  specific_humidity_2m: {
    id: "specific_humidity_2m",
    kind: "derived",
    dependencies: ["temperature_2m", "dew_point_2m", "surface_pressure"],
    temporalSemantics: "instantaneous",
  },
  u_wind_10m: rawField("u_wind_10m", "10u", "m/s"),
  v_wind_10m: rawField("v_wind_10m", "10v", "m/s"),
  wind_10m: {
    id: "wind_10m",
    kind: "derived",
    dependencies: ["u_wind_10m", "v_wind_10m"],
    temporalSemantics: "instantaneous",
  },
  u_wind_100m: rawField("u_wind_100m", "100u", "m/s"),
  v_wind_100m: rawField("v_wind_100m", "100v", "m/s"),
  wind_100m: {
    id: "wind_100m",
    kind: "derived",
    dependencies: ["u_wind_100m", "v_wind_100m"],
    temporalSemantics: "instantaneous",
  },
  total_precipitation: rawField("total_precipitation", "tp", "m", "accumulation"),
  low_cloud_cover: rawField("low_cloud_cover", "lcc", "fraction"),
  middle_cloud_cover: rawField("middle_cloud_cover", "mcc", "fraction"),
  high_cloud_cover: rawField("high_cloud_cover", "hcc", "fraction"),
  total_atmosphere_cloud_cover: rawField("total_atmosphere_cloud_cover", "tcc", "fraction"),
};

const pressureLevelSet = new Set<number>(AIFS_PRESSURE_LEVELS_HPA);
const pressureVariableSet = new Set<string>(AIFS_PRESSURE_VARIABLE_IDS);
const rawPressureVariableSet = new Set<string>(AIFS_RAW_PRESSURE_VARIABLE_IDS);
const fieldSet = new Set<string>(AIFS_FIELD_IDS);
const areaFieldSet = new Set<string>(AIFS_AREA_FIELD_IDS);

export function isAifsPressureLevel(value: number): boolean {
  return pressureLevelSet.has(value);
}

export function isAifsPressureVariable(value: string): value is AifsPressureVariableId {
  return pressureVariableSet.has(value);
}

export function isAifsRawPressureVariable(value: string): value is AifsRawPressureVariableId {
  return rawPressureVariableSet.has(value);
}

export function isAifsField(value: string): value is AifsFieldId {
  return fieldSet.has(value);
}

export function isAifsAreaField(value: string): value is AifsRawFieldId {
  return areaFieldSet.has(value);
}

export function expandAifsPressureVariables(ids: readonly AifsPressureVariableId[]): AifsRawPressureVariableId[] {
  const raw = new Set<AifsRawPressureVariableId>();
  for (const id of ids) {
    if (isAifsRawPressureVariable(id)) {
      raw.add(id);
      continue;
    }
    const definition = VARIABLE_CATALOG[id];
    if (definition.kind !== "derived") {
      throw new Error(`AIFS variable ${id} is not available`);
    }
    for (const dependency of definition.dependencies) {
      if (!isAifsRawPressureVariable(dependency)) {
        throw new Error(`AIFS variable ${id} requires unsupported pressure dependency ${dependency}`);
      }
      raw.add(dependency);
    }
  }
  return [...raw];
}

export function expandAifsFields(ids: readonly AifsFieldId[]): AifsRawFieldId[] {
  const raw = new Set<AifsRawFieldId>();
  for (const id of ids) {
    const definition = AIFS_FIELD_CATALOG[id];
    if (definition.kind === "raw") raw.add(definition.id);
    else for (const dependency of definition.dependencies) raw.add(dependency);
  }
  return [...raw];
}

export function getAifsCatalog() {
  return {
    model: "aifs_0p25" as const,
    provider: "ECMWF Open Data" as const,
    horizontalGridDegrees: 0.25 as const,
    cyclesUtc: [0, 6, 12, 18] as const,
    pressureLevelsHpa: [...AIFS_PRESSURE_LEVELS_HPA],
    cadenceNote: "AIFS Single publishes 6-hourly forecast output through f360 for all four daily cycles.",
    variables: AIFS_PRESSURE_VARIABLE_IDS.map((id) => {
      const definition = VARIABLE_CATALOG[id];
      return {
        id,
        kind: definition.kind,
        description: definition.description,
        levelType: "isobaric_hpa" as const,
        outputs: definition.outputs.map((output) => ({ ...output })),
        supportedPressureLevelsHpa: [...AIFS_PRESSURE_LEVELS_HPA],
        ...(definition.kind === "raw"
          ? { sourceParam: AIFS_RAW_PRESSURE_VARIABLE_CATALOG[id as AifsRawPressureVariableId].param }
          : { dependencies: [...definition.dependencies] }),
      };
    }),
    fields: AIFS_FIELD_IDS.map((id) => {
      const source = AIFS_FIELD_CATALOG[id];
      const canonical = NON_ISOBARIC_FIELD_CATALOG[id];
      return {
        id,
        kind: source.kind,
        description: canonical.description,
        verticalSemantics: canonical.level.gribLevel,
        temporalSemantics: source.temporalSemantics,
        outputs: canonical.outputs.map((output) => ({ ...output })),
        ...(source.kind === "raw"
          ? { sourceParam: source.param, sourceLevtype: "sfc" as const }
          : { dependencies: [...source.dependencies] }),
      };
    }),
  };
}

function rawField(
  id: AifsRawFieldId,
  param: string,
  sourceUnit: string,
  temporalSemantics: "instantaneous" | "accumulation" = "instantaneous",
): AifsRawFieldDefinition {
  return { id, kind: "raw", param, sourceUnit, temporalSemantics };
}
