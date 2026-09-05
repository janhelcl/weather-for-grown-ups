import { NON_ISOBARIC_FIELD_CATALOG } from "./non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "./variables.js";

export const HISTORICAL_AREA_PRESSURE_VARIABLE_IDS = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "vertical_velocity",
  "absolute_vorticity",
  "cloud_water_mixing_ratio",
  "ozone_mixing_ratio",
] as const;

export type HistoricalAreaPressureVariableId =
  (typeof HISTORICAL_AREA_PRESSURE_VARIABLE_IDS)[number];

export const HISTORICAL_AREA_FIELD_IDS = [
  "surface_pressure",
  "surface_geopotential_height",
  "surface_temperature",
  "surface_cape",
  "surface_cin",
  "temperature_2m",
  "relative_humidity_2m",
  "specific_humidity_2m",
  "dew_point_2m",
  "u_wind_10m",
  "v_wind_10m",
  "temperature_80m",
  "specific_humidity_80m",
  "pressure_80m",
  "u_wind_80m",
  "v_wind_80m",
  "temperature_100m",
  "u_wind_100m",
  "v_wind_100m",
  "precipitable_water",
  "total_column_cloud_water",
  "column_relative_humidity",
  "total_column_ozone",
] as const;

export type HistoricalAreaFieldId = (typeof HISTORICAL_AREA_FIELD_IDS)[number];

export interface HistoricalAreaSourceDefinition {
  id: HistoricalAreaPressureVariableId | HistoricalAreaFieldId;
  verticalCoordinate?: (selection: { pressureLevelHpa?: number }) => number | undefined;
  outputField: string;
  unit: string;
  transform(value: number): number;
}

const identity = (value: number) => value;
const kelvinToCelsius = (value: number) => value - 273.15;

function pressure(
  id: HistoricalAreaPressureVariableId,
  transform: (value: number) => number = identity,
): HistoricalAreaSourceDefinition {
  const output = VARIABLE_CATALOG[id].outputs[0];
  if (!output) throw new Error(`Historical area pressure variable ${id} has no public output`);
  return {
    id,
    verticalCoordinate: ({ pressureLevelHpa }) =>
      pressureLevelHpa === undefined ? undefined : pressureLevelHpa * 100,
    outputField: output.field,
    unit: output.unit,
    transform,
  };
}

function field(
  id: HistoricalAreaFieldId,
  heightM?: number,
  transform: (value: number) => number = identity,
): HistoricalAreaSourceDefinition {
  const output = NON_ISOBARIC_FIELD_CATALOG[id].outputs[0];
  if (!output) throw new Error(`Historical area field ${id} has no public output`);
  return {
    id,
    ...(heightM === undefined ? {} : {
      verticalCoordinate: () => heightM,
    }),
    outputField: output.field,
    unit: output.unit,
    transform,
  };
}

export const HISTORICAL_AREA_PRESSURE_CATALOG: Record<
  HistoricalAreaPressureVariableId,
  HistoricalAreaSourceDefinition
> = {
  temperature: pressure("temperature", kelvinToCelsius),
  relative_humidity: pressure("relative_humidity"),
  u_wind: pressure("u_wind"),
  v_wind: pressure("v_wind"),
  geopotential_height: pressure("geopotential_height"),
  vertical_velocity: pressure("vertical_velocity"),
  absolute_vorticity: pressure("absolute_vorticity"),
  cloud_water_mixing_ratio: pressure("cloud_water_mixing_ratio"),
  ozone_mixing_ratio: pressure("ozone_mixing_ratio"),
};

export const HISTORICAL_AREA_FIELD_CATALOG: Record<
  HistoricalAreaFieldId,
  HistoricalAreaSourceDefinition
> = {
  surface_pressure: field("surface_pressure"),
  surface_geopotential_height: field("surface_geopotential_height"),
  surface_temperature: field("surface_temperature", undefined, kelvinToCelsius),
  surface_cape: field("surface_cape"),
  surface_cin: field("surface_cin"),
  temperature_2m: field("temperature_2m", 2, kelvinToCelsius),
  relative_humidity_2m: field("relative_humidity_2m", 2),
  specific_humidity_2m: field("specific_humidity_2m", 2),
  dew_point_2m: field("dew_point_2m", 2, kelvinToCelsius),
  u_wind_10m: field("u_wind_10m", 10),
  v_wind_10m: field("v_wind_10m", 10),
  temperature_80m: field("temperature_80m", 80, kelvinToCelsius),
  specific_humidity_80m: field("specific_humidity_80m", 80),
  pressure_80m: field("pressure_80m", 80),
  u_wind_80m: field("u_wind_80m", 80),
  v_wind_80m: field("v_wind_80m", 80),
  temperature_100m: field("temperature_100m", 100, kelvinToCelsius),
  u_wind_100m: field("u_wind_100m", 100),
  v_wind_100m: field("v_wind_100m", 100),
  precipitable_water: field("precipitable_water"),
  total_column_cloud_water: field("total_column_cloud_water"),
  column_relative_humidity: field("column_relative_humidity"),
  total_column_ozone: field("total_column_ozone"),
};
