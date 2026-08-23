import type { NonIsobaricFieldId } from "./non-isobaric-fields.js";
import type { RawVariableId } from "../schema/query.js";
import type { VariableOutput } from "./variables.js";

export const PARCEL_DEFINITION_IDS = [
  "surface_2m",
  "mixed_layer_100hpa",
  "most_unstable_300hpa",
] as const;

export type ParcelDefinitionId = (typeof PARCEL_DEFINITION_IDS)[number];

export interface ParcelDefinition {
  id: ParcelDefinitionId;
  kind: "derived_parcel";
  pressureDependencies: readonly RawVariableId[];
  fieldDependencies: readonly NonIsobaricFieldId[];
  description: string;
  outputs: readonly VariableOutput[];
}

const commonPressureDependencies = ["temperature", "specific_humidity", "geopotential_height"] as const;
const commonFieldDependencies = [
  "surface_pressure",
  "surface_geopotential_height",
  "temperature_2m",
  "specific_humidity_2m",
] as const;

const parcelOutputs: readonly VariableOutput[] = [
  { field: "lcl.pressureHpa", unit: "hPa", description: "Lifted condensation level pressure" },
  { field: "lcl.temperatureC", unit: "degC", description: "Lifted condensation level parcel temperature" },
  { field: "lfc.pressureHpa", unit: "hPa", description: "First level of free convection pressure, when present" },
  { field: "el.pressureHpa", unit: "hPa", description: "First equilibrium level above the LFC, when present" },
  { field: "capeJkg", unit: "J/kg", description: "CAPE in the first contiguous positive-buoyancy layer from the LFC to EL or profile top" },
  { field: "cinJkg", unit: "J/kg", description: "Negative convective inhibition integrated from parcel start to the LFC or profile top" },
];

export const PARCEL_DIAGNOSTIC_CATALOG: Record<ParcelDefinitionId, ParcelDefinition> = {
  surface_2m: {
    id: "surface_2m",
    kind: "derived_parcel",
    pressureDependencies: commonPressureDependencies,
    fieldDependencies: commonFieldDependencies,
    description: "Surface parcel initialized from GFS surface pressure and geopotential height with 2 m air temperature and specific humidity",
    outputs: parcelOutputs,
  },
  mixed_layer_100hpa: {
    id: "mixed_layer_100hpa",
    kind: "derived_parcel",
    pressureDependencies: commonPressureDependencies,
    fieldDependencies: commonFieldDependencies,
    description: "100 hPa mixed-layer parcel initialized at surface pressure from pressure-weighted mean potential temperature and mixing ratio over the lowest 100 hPa",
    outputs: parcelOutputs,
  },
  most_unstable_300hpa: {
    id: "most_unstable_300hpa",
    kind: "derived_parcel",
    pressureDependencies: commonPressureDependencies,
    fieldDependencies: commonFieldDependencies,
    description: "Most-unstable parcel selected from the sampled surface-to-300 hPa layer by maximum Bolton equivalent potential temperature",
    outputs: parcelOutputs,
  },
};
