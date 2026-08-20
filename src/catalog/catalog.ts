import { NON_ISOBARIC_FIELD_CATALOG } from "./non-isobaric-fields.js";
import { GFS_PRESSURE_LEVELS_HPA } from "./pressure-levels.js";
import { VARIABLE_CATALOG } from "./variables.js";

export function getGfsPressureCatalog() {
  return {
    model: "gfs_0p25" as const,
    levelType: "isobaric_hpa" as const,
    pressureLevelsHpa: [...GFS_PRESSURE_LEVELS_HPA],
    availabilityNote:
      "Not every variable is present at every pressure level. Queries fail clearly when a requested variable/level combination is unavailable in the selected GFS file.",
    variables: Object.values(VARIABLE_CATALOG).map((definition) =>
      definition.kind === "raw"
        ? {
            id: definition.id,
            kind: definition.kind,
            levelType: definition.levelType,
            gfsCode: definition.gfsCode,
            sourceUnit: definition.sourceUnit,
            description: definition.description,
            outputs: [...definition.outputs],
          }
        : {
            id: definition.id,
            kind: definition.kind,
            levelType: definition.levelType,
            dependencies: [...definition.dependencies],
            description: definition.description,
            outputs: [...definition.outputs],
          },
    ),
    fieldSemanticsNote:
      "Non-isobaric fields carry explicit vertical and temporal semantics. Named layers/levels remain distinct from pressure surfaces; accumulation and average results include their exact GFS forecast-hour interval.",
    fields: Object.values(NON_ISOBARIC_FIELD_CATALOG).map((definition) =>
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
