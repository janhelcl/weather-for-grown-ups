import type { RawVariableId } from "../schema/query.js";
import type { VariableOutput } from "./variables.js";

export const LAYER_DIAGNOSTIC_IDS = [
  "temperature_lapse_rate",
  "wind_shear",
  "potential_temperature_gradient",
] as const;

export type LayerDiagnosticId = (typeof LAYER_DIAGNOSTIC_IDS)[number];

export interface LayerDiagnosticDefinition {
  id: LayerDiagnosticId;
  kind: "derived_layer";
  verticalSemantics: "pressure_layer";
  dependencies: readonly RawVariableId[];
  description: string;
  outputs: readonly VariableOutput[];
}

export const LAYER_DIAGNOSTIC_CATALOG: Record<LayerDiagnosticId, LayerDiagnosticDefinition> = {
  temperature_lapse_rate: {
    id: "temperature_lapse_rate",
    kind: "derived_layer",
    verticalSemantics: "pressure_layer",
    dependencies: ["temperature", "geopotential_height"],
    description: "Environmental temperature lapse rate across a pressure layer; positive when temperature decreases with height",
    outputs: [
      { field: "temperatureLapseRateCPerKm", unit: "degC/km", description: "Temperature decrease per kilometre of geopotential-height difference" },
    ],
  },
  wind_shear: {
    id: "wind_shear",
    kind: "derived_layer",
    verticalSemantics: "pressure_layer",
    dependencies: ["u_wind", "v_wind", "geopotential_height"],
    description: "Vector wind change from the lower to upper pressure surface, with magnitude and depth-normalized shear",
    outputs: [
      { field: "uWindShearMs", unit: "m/s", description: "Upper-minus-lower eastward wind component" },
      { field: "vWindShearMs", unit: "m/s", description: "Upper-minus-lower northward wind component" },
      { field: "windShearMagnitudeMs", unit: "m/s", description: "Magnitude of the vector wind change across the layer" },
      { field: "windShearMsPerKm", unit: "m/s/km", description: "Vector wind-change magnitude per kilometre of geopotential-height difference" },
    ],
  },
  potential_temperature_gradient: {
    id: "potential_temperature_gradient",
    kind: "derived_layer",
    verticalSemantics: "pressure_layer",
    dependencies: ["temperature", "geopotential_height"],
    description: "Potential-temperature increase from the lower to upper pressure surface per kilometre of geopotential-height difference",
    outputs: [
      { field: "potentialTemperatureGradientKPerKm", unit: "K/km", description: "Upper-minus-lower potential temperature per kilometre of geopotential-height difference" },
    ],
  },
};

export function expandLayerDiagnosticVariables(ids: readonly LayerDiagnosticId[]): RawVariableId[] {
  const dependencies = new Set<RawVariableId>();
  for (const id of ids) {
    for (const dependency of LAYER_DIAGNOSTIC_CATALOG[id].dependencies) dependencies.add(dependency);
  }
  return [...dependencies];
}
