import { NON_ISOBARIC_FIELD_CATALOG } from "./non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "./variables.js";

export const IFS_PRESSURE_LEVELS_HPA = [
  1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10,
] as const;

export const IFS_RAW_PRESSURE_VARIABLE_IDS = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
  "relative_vorticity",
  "divergence",
] as const;

export const IFS_PRESSURE_VARIABLE_IDS = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
  "absolute_vorticity",
  "divergence",
  "wind",
  "dew_point",
  "potential_temperature",
  "mixing_ratio",
  "virtual_temperature",
  "air_density",
  "wet_bulb_temperature",
  "equivalent_potential_temperature",
] as const;

export type IfsRawPressureVariableId = (typeof IFS_RAW_PRESSURE_VARIABLE_IDS)[number];
export type IfsPressureVariableId = (typeof IFS_PRESSURE_VARIABLE_IDS)[number];

export interface IfsRawPressureVariableDefinition {
  id: IfsRawPressureVariableId;
  param: string;
  sourceUnit: string;
}

export const IFS_RAW_PRESSURE_VARIABLE_CATALOG: Record<IfsRawPressureVariableId, IfsRawPressureVariableDefinition> = {
  temperature: { id: "temperature", param: "t", sourceUnit: "K" },
  relative_humidity: { id: "relative_humidity", param: "r", sourceUnit: "%" },
  u_wind: { id: "u_wind", param: "u", sourceUnit: "m/s" },
  v_wind: { id: "v_wind", param: "v", sourceUnit: "m/s" },
  geopotential_height: { id: "geopotential_height", param: "gh", sourceUnit: "gpm" },
  specific_humidity: { id: "specific_humidity", param: "q", sourceUnit: "kg/kg" },
  vertical_velocity: { id: "vertical_velocity", param: "w", sourceUnit: "Pa/s" },
  relative_vorticity: { id: "relative_vorticity", param: "vo", sourceUnit: "1/s" },
  divergence: { id: "divergence", param: "d", sourceUnit: "1/s" },
};

export const IFS_RAW_FIELD_IDS = [
  "surface_pressure",
  "surface_geopotential_height",
  "temperature_2m",
  "dew_point_2m",
  "u_wind_10m",
  "v_wind_10m",
  "u_wind_100m",
  "v_wind_100m",
  "total_precipitation",
  "precipitable_water",
  "low_cloud_cover",
  "middle_cloud_cover",
  "high_cloud_cover",
  "total_atmosphere_cloud_cover",
] as const;

export const IFS_FIELD_IDS = [
  ...IFS_RAW_FIELD_IDS,
  "relative_humidity_2m",
  "specific_humidity_2m",
  "wind_10m",
  "wind_100m",
] as const;

export type IfsRawFieldId = (typeof IFS_RAW_FIELD_IDS)[number];
export type IfsFieldId = (typeof IFS_FIELD_IDS)[number];

export interface IfsRawFieldDefinition {
  id: IfsRawFieldId;
  kind: "raw";
  param: string;
  levtype: "sfc";
  sourceUnit: string;
  temporalSemantics: "instantaneous" | "accumulation";
  sourceForecastHour?: number;
}

export interface IfsDerivedFieldDefinition {
  id: "wind_10m" | "wind_100m" | "relative_humidity_2m" | "specific_humidity_2m";
  kind: "derived";
  dependencies: readonly IfsRawFieldId[];
  temporalSemantics: "instantaneous";
}

export type IfsFieldDefinition = IfsRawFieldDefinition | IfsDerivedFieldDefinition;

export const IFS_FIELD_CATALOG: Record<IfsFieldId, IfsFieldDefinition> = {
  surface_pressure: rawField("surface_pressure", "sp", "Pa"),
  surface_geopotential_height: rawField(
    "surface_geopotential_height",
    "z",
    "m^2/s^2",
    "instantaneous",
    0,
  ),
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
  precipitable_water: rawField("precipitable_water", "tcwv", "kg/m^2"),
  low_cloud_cover: rawField("low_cloud_cover", "lcc", "fraction"),
  middle_cloud_cover: rawField("middle_cloud_cover", "mcc", "fraction"),
  high_cloud_cover: rawField("high_cloud_cover", "hcc", "fraction"),
  total_atmosphere_cloud_cover: rawField("total_atmosphere_cloud_cover", "tcc", "fraction"),
};

export function isIfsPressureLevel(value: number): value is (typeof IFS_PRESSURE_LEVELS_HPA)[number] {
  return (IFS_PRESSURE_LEVELS_HPA as readonly number[]).includes(value);
}

export function expandIfsPressureVariables(ids: readonly IfsPressureVariableId[]): IfsRawPressureVariableId[] {
  const raw = new Set<IfsRawPressureVariableId>();
  for (const id of ids) {
    if (id === "absolute_vorticity") {
      raw.add("relative_vorticity");
      continue;
    }
    if ((IFS_RAW_PRESSURE_VARIABLE_IDS as readonly string[]).includes(id)) {
      raw.add(id as IfsRawPressureVariableId);
      continue;
    }
    const definition = VARIABLE_CATALOG[id];
    if (definition.kind !== "derived") throw new Error(`IFS variable ${id} is not available as a derived pressure variable`);
    for (const dependency of definition.dependencies) {
      if (!(IFS_RAW_PRESSURE_VARIABLE_IDS as readonly string[]).includes(dependency)) {
        throw new Error(`IFS variable ${id} requires unsupported pressure dependency ${dependency}`);
      }
      raw.add(dependency as IfsRawPressureVariableId);
    }
  }
  return [...raw];
}

export function expandIfsFields(ids: readonly IfsFieldId[]): IfsRawFieldId[] {
  const raw = new Set<IfsRawFieldId>();
  for (const id of ids) {
    const definition = IFS_FIELD_CATALOG[id];
    if (definition.kind === "raw") raw.add(definition.id);
    else for (const dependency of definition.dependencies) raw.add(dependency);
  }
  return [...raw];
}

export function getIfsCatalog() {
  return {
    model: "ifs_0p25" as const,
    provider: "ECMWF Open Data" as const,
    horizontalGridDegrees: 0.25 as const,
    cyclesUtc: [0, 6, 12, 18] as const,
    pressureLevelsHpa: [...IFS_PRESSURE_LEVELS_HPA],
    cadenceNote:
      "00/12Z runs are 3-hourly through f144 then 6-hourly through f240; 06/18Z runs are 3-hourly through f90 under IFS Cycle 50r1.",
    variables: IFS_PRESSURE_VARIABLE_IDS.map((id) => {
      const definition = VARIABLE_CATALOG[id];
      return {
        id,
        kind: definition.kind,
        description: definition.description,
        levelType: "isobaric_hpa" as const,
        outputs: definition.outputs.map((output) => ({ ...output })),
        supportedPressureLevelsHpa: [...IFS_PRESSURE_LEVELS_HPA],
        ...(definition.kind === "raw"
          ? {
              sourceParam: IFS_RAW_PRESSURE_VARIABLE_CATALOG[
                id === "absolute_vorticity" ? "relative_vorticity" : id as IfsRawPressureVariableId
              ].param,
            }
          : { dependencies: [...definition.dependencies] }),
      };
    }),
    fields: IFS_FIELD_IDS.map((id) => {
      const source = IFS_FIELD_CATALOG[id];
      const canonical = NON_ISOBARIC_FIELD_CATALOG[id];
      return {
        id,
        kind: source.kind,
        description: canonical.description,
        verticalSemantics: canonical.level.gribLevel,
        temporalSemantics: source.temporalSemantics,
        outputs: canonical.outputs.map((output) => ({ ...output })),
        ...(source.kind === "raw"
          ? {
              sourceParam: source.param,
              sourceLevtype: source.levtype,
              ...(source.sourceForecastHour === undefined
                ? {}
                : { sourceForecastHour: source.sourceForecastHour }),
            }
          : { dependencies: [...source.dependencies] }),
      };
    }),
  };
}

function rawField(
  id: IfsRawFieldId,
  param: string,
  sourceUnit: string,
  temporalSemantics: "instantaneous" | "accumulation" = "instantaneous",
  sourceForecastHour?: number,
): IfsRawFieldDefinition {
  return {
    id,
    kind: "raw",
    param,
    levtype: "sfc",
    sourceUnit,
    temporalSemantics,
    ...(sourceForecastHour === undefined ? {} : { sourceForecastHour }),
  };
}
