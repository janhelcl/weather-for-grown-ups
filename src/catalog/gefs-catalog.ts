import { LAYER_DIAGNOSTIC_CATALOG } from "./layer-diagnostics.js";
import { PROFILE_DIAGNOSTIC_CATALOG } from "./profile-diagnostics.js";
import {
  GEFS_PGRB2A_COMMON_PRESSURE_LEVELS_HPA,
  GEFS_PGRB2A_PRESSURE_VARIABLES,
  GEFS_PGRB2A_WIND_EXTRA_PRESSURE_LEVELS_HPA,
} from "./gefs.js";
import { GEFS_PGRB2A_FIELD_CATALOG } from "./gefs-fields.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "./variables.js";

export function getGefsCatalog() {
  return {
    model: "gefs_0p50" as const,
    product: "pgrb2a_0p50" as const,
    members: 31,
    levelType: "isobaric_hpa" as const,
    availabilityNote:
      "The WFG GEFS pgrb2a contract exposes only combinations verified for this product. Pressure-level support is intentionally narrower than deterministic GFS; pgrb2b expansion is a separate product surface.",
    variables: GEFS_PGRB2A_PRESSURE_VARIABLES.map((id) => {
      const definition = VARIABLE_CATALOG[id] as RawVariableDefinition;
      const wind = id === "u_wind" || id === "v_wind";
      return {
        id,
        kind: "raw" as const,
        levelType: definition.levelType,
        gfsCode: definition.gfsCode,
        sourceUnit: definition.sourceUnit,
        description: definition.description,
        outputs: [...definition.outputs],
        supportedPressureLevelsHpa: [
          ...GEFS_PGRB2A_COMMON_PRESSURE_LEVELS_HPA,
          ...(wind ? GEFS_PGRB2A_WIND_EXTRA_PRESSURE_LEVELS_HPA : []),
        ].sort((a, b) => b - a),
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
      "Parcel diagnostics are not yet exposed for GEFS. The field catalog now carries the near-surface foundation needed to add member-first parcel diagnostics without borrowing GFS surface semantics.",
    parcelDefinitions: [],
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
