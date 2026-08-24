import { LAYER_DIAGNOSTIC_CATALOG } from "./layer-diagnostics.js";
import { PARCEL_DIAGNOSTIC_CATALOG } from "./parcel-diagnostics.js";
import { PROFILE_DIAGNOSTIC_CATALOG } from "./profile-diagnostics.js";
import {
  GEFS_PGRB2A_COMMON_PRESSURE_LEVELS_HPA,
  GEFS_PGRB2A_WIND_EXTRA_PRESSURE_LEVELS_HPA,
  GEFS_PROFILE_VARIABLES,
  gefsProfileRawDependencies,
  type GefsProfileVariableId,
} from "./gefs.js";
import { GEFS_PGRB2A_FIELD_CATALOG } from "./gefs-fields.js";
import { VARIABLE_CATALOG } from "./variables.js";

export function getGefsCatalog() {
  return {
    model: "gefs_0p50" as const,
    product: "pgrb2a_0p50" as const,
    members: 31,
    levelType: "isobaric_hpa" as const,
    availabilityNote:
      "The WFG GEFS pgrb2a contract exposes only combinations verified for this product. Pressure-level support is intentionally narrower than deterministic GFS; pgrb2b expansion is a separate product surface.",
    variables: GEFS_PROFILE_VARIABLES.map((id) => {
      const definition = VARIABLE_CATALOG[id];
      const supportedPressureLevelsHpa = supportedLevels(id);
      if (definition.kind === "raw") {
        return {
          id,
          kind: definition.kind,
          levelType: definition.levelType,
          gfsCode: definition.gfsCode,
          sourceUnit: definition.sourceUnit,
          description: definition.description,
          outputs: [...definition.outputs],
          supportedPressureLevelsHpa,
        };
      }
      return {
        id,
        kind: definition.kind,
        levelType: definition.levelType,
        dependencies: [...definition.dependencies],
        description: `${definition.description}; evaluated independently for every selected GEFS member before distribution aggregation`,
        outputs: [...definition.outputs],
        supportedPressureLevelsHpa,
      };
    }),
    layerDiagnosticsNote:
      "GEFS layer diagnostics use the same physical kernels as GFS, evaluated independently for every member before distribution summaries are calculated.",
    layerDiagnostics: Object.values(LAYER_DIAGNOSTIC_CATALOG).map((definition) => ({
      id: definition.id,
      kind: definition.kind,
      verticalSemantics: definition.verticalSemantics,
      dependencies: [...definition.dependencies],
      description: definition.description,
      outputs: [...definition.outputs],
    })),
    profileDiagnosticsNote:
      "GEFS whole-profile structures are derived independently for every member and summarized structurally; event fractions are raw member fractions, not calibrated probabilities.",
    profileDiagnostics: Object.values(PROFILE_DIAGNOSTIC_CATALOG).map((definition) => ({
      id: definition.id,
      kind: definition.kind,
      verticalSemantics: definition.verticalSemantics,
      dependencies: [...definition.dependencies],
      description: definition.description,
      outputs: [...definition.outputs],
    })),
    parcelDiagnosticsNote:
      "GEFS parcel diagnostics reuse the deterministic parcel physics member-by-member. Pressure-level and 2 m moisture are derived from GEFS temperature/RH/pressure; same-cycle f000 surface HGT supplies static model orography. Structural fractions are raw member fractions, not calibrated probabilities.",
    parcelDefinitions: Object.values(PARCEL_DIAGNOSTIC_CATALOG).map((definition) => ({
      id: definition.id,
      kind: definition.kind,
      pressureDependencies: ["temperature", "relative_humidity", "geopotential_height"] as const,
      fieldDependencies: ["surface_pressure", "temperature_2m", "relative_humidity_2m"] as const,
      staticDependencies: ["same_cycle_f000_surface_geopotential_height"] as const,
      description: gefsParcelDescription(definition.id),
      outputs: [...definition.outputs],
    })),
    fieldSemanticsNote:
      "GEFS non-isobaric fields have product-specific vertical and temporal semantics. CAPE/CIN here are the pgrb2a 180-0 hPa above-ground layer; precipitation is accumulated and total cloud cover is interval-averaged.",
    fields: Object.values(GEFS_PGRB2A_FIELD_CATALOG).map((definition) =>
      definition.kind === "raw"
        ? {
            id: definition.id,
            kind: definition.kind,
            level: { ...definition.level },
            temporalSemantics: definition.temporalSemantics,
            gfsCode: definition.gfsCode,
            sourceUnit: definition.sourceUnit,
            description: definition.description,
            outputs: [...definition.outputs],
          }
        : {
            id: definition.id,
            kind: definition.kind,
            level: { ...definition.level },
            temporalSemantics: definition.temporalSemantics,
            dependencies: [...definition.dependencies],
            description: definition.description,
            outputs: [...definition.outputs],
          },
    ),
  };
}

function supportedLevels(variable: GefsProfileVariableId): number[] {
  const dependencies = gefsProfileRawDependencies(variable);
  const windOnly = dependencies.every((dependency) => dependency === "u_wind" || dependency === "v_wind");
  return [
    ...GEFS_PGRB2A_COMMON_PRESSURE_LEVELS_HPA,
    ...(windOnly ? GEFS_PGRB2A_WIND_EXTRA_PRESSURE_LEVELS_HPA : []),
  ].sort((a, b) => b - a);
}

function gefsParcelDescription(id: keyof typeof PARCEL_DIAGNOSTIC_CATALOG): string {
  switch (id) {
    case "surface_2m":
      return "Surface parcel initialized independently for each GEFS member from surface pressure/orography plus 2 m temperature and RH-derived specific humidity";
    case "mixed_layer_100hpa":
      return "100 hPa mixed-layer parcel evaluated independently for each GEFS member from pressure-weighted mean potential temperature and RH-derived moisture over the lowest 100 hPa";
    case "most_unstable_300hpa":
      return "Most-unstable parcel selected independently in each GEFS member from the sampled surface-to-300 hPa layer by maximum Bolton equivalent potential temperature";
  }
}
