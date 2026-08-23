import type { RawVariableId } from "../schema/query.js";
import type { VariableOutput } from "./variables.js";

export const PROFILE_DIAGNOSTIC_IDS = [
  "freezing_level_crossings",
  "temperature_inversion_layers",
] as const;

export type ProfileDiagnosticId = (typeof PROFILE_DIAGNOSTIC_IDS)[number];

export interface ProfileDiagnosticDefinition {
  id: ProfileDiagnosticId;
  kind: "derived_profile";
  verticalSemantics: "sampled_pressure_profile";
  dependencies: readonly RawVariableId[];
  description: string;
  outputs: readonly VariableOutput[];
}

export const PROFILE_DIAGNOSTIC_CATALOG: Record<ProfileDiagnosticId, ProfileDiagnosticDefinition> = {
  freezing_level_crossings: {
    id: "freezing_level_crossings",
    kind: "derived_profile",
    verticalSemantics: "sampled_pressure_profile",
    dependencies: ["temperature", "geopotential_height"],
    description: "All sampled or interpolated 0 degC crossings found between requested pressure levels, ordered by geopotential height",
    outputs: [
      { field: "crossings[].geopotentialHeightGpm", unit: "gpm", description: "Interpolated or sampled freezing-level geopotential height" },
      { field: "crossings[].pressureHpa", unit: "hPa", description: "Interpolated or sampled freezing-level pressure" },
    ],
  },
  temperature_inversion_layers: {
    id: "temperature_inversion_layers",
    kind: "derived_profile",
    verticalSemantics: "sampled_pressure_profile",
    dependencies: ["temperature", "geopotential_height"],
    description: "Contiguous sampled profile segments where temperature increases with geopotential height, merged into inversion layers",
    outputs: [
      { field: "layers[].depthGpm", unit: "gpm", description: "Sampled inversion-layer geopotential depth" },
      { field: "layers[].temperatureIncreaseC", unit: "degC", description: "Temperature increase from inversion base to top" },
      { field: "layers[].meanTemperatureGradientCPerKm", unit: "degC/km", description: "Base-to-top temperature increase per kilometre" },
    ],
  },
};

export function expandProfileDiagnosticVariables(ids: readonly ProfileDiagnosticId[]): RawVariableId[] {
  const dependencies = new Set<RawVariableId>();
  for (const id of ids) {
    for (const dependency of PROFILE_DIAGNOSTIC_CATALOG[id].dependencies) dependencies.add(dependency);
  }
  return [...dependencies];
}
