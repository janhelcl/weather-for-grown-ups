import { getGefsCatalog } from "./gefs-catalog.js";
import {
  AIGFS_FIELD_IDS,
  AIGFS_PRESSURE_VARIABLE_IDS,
} from "./aigfs.js";
import { AROME_0P01_FIELD_IDS, aromeFieldDefinition } from "./arome.js";
import { PE_AROME_FIELD_IDS } from "./pe-arome.js";
import {
  ICON_D2_FIELD_IDS,
  ICON_D2_PRESSURE_VARIABLE_IDS,
  iconD2FieldDefinition,
} from "./icon-d2.js";
import {
  GEFS_REFORECAST_FIELD_IDS,
  GEFS_REFORECAST_PRESSURE_VARIABLE_IDS,
} from "./gefs-reforecast.js";
import { getGfsPressureCatalog } from "./catalog.js";
import { getIfsCatalog } from "./ifs.js";
import { getAifsCatalog } from "./aifs.js";
import { LAYER_DIAGNOSTIC_CATALOG } from "./layer-diagnostics.js";
import { NON_ISOBARIC_FIELD_CATALOG } from "./non-isobaric-fields.js";
import { PARCEL_DIAGNOSTIC_CATALOG } from "./parcel-diagnostics.js";
import { PROFILE_DIAGNOSTIC_CATALOG } from "./profile-diagnostics.js";
import { VARIABLE_CATALOG } from "./variables.js";
import { HISTORICAL_GFS_FIELD_IDS } from "../schema/history-fields.js";
import { HISTORICAL_GFS_VARIABLE_IDS } from "../schema/history.js";
import type { PublicAtmosphericDataset } from "../schema/unified-api.js";

export type UnifiedSection = (typeof import("../schema/unified-catalog.js").UNIFIED_CATALOG_SECTIONS)[number];

export interface CatalogEntry {
  dataset: PublicAtmosphericDataset;
  section: UnifiedSection;
  id: string;
  classification: "raw" | "derived";
  kind: string;
  description: string;
  verticalSemantics: string;
  temporalSemantics?: "instantaneous" | "accumulation" | "average" | "maximum";
  outputs: Array<{ field: string; unit: string; description?: string }>;
}

// Registration order preserves canonical representative preference independently of
// the caller's dataset order (which controls support rows only).
export const CATALOG_ENTRY_FACTORIES: Record<PublicAtmosphericDataset, () => CatalogEntry[]> = {
  gfs: gfsEntries,
  aigfs: () => aigfsEntries("aigfs"),
  aigefs: () => aigfsEntries("aigefs"),
  hgefs: () => aigfsEntries("hgefs"),
  "icon-d2": () => iconD2Entries("icon-d2"),
  "icon-d2-eps": () => iconD2Entries("icon-d2-eps"),
  arome: aromeEntries,
  "pe-arome": peAromeEntries,
  gefs: gefsEntries,
  ifs: () => ifsEntries("ifs"),
  aifs: () => aifsEntries("aifs"),
  "aifs-ens": () => aifsEntries("aifs-ens"),
  "ifs-ens": () => ifsEntries("ifs-ens"),
  "gfs-analysis": historyEntries,
};

function aigfsEntries(dataset: "aigfs" | "aigefs" | "hgefs"): CatalogEntry[] {
  const fields = AIGFS_FIELD_IDS.map((id) => NON_ISOBARIC_FIELD_CATALOG[id]);
  return [
    ...AIGFS_PRESSURE_VARIABLE_IDS.map((id) => {
      const definition = VARIABLE_CATALOG[id];
      return {
        dataset,
        section: "variables" as const,
        id,
        classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
        kind: definition.kind,
        description: definition.description,
        verticalSemantics: definition.levelType,
        outputs: definition.outputs.map((output) => ({ ...output })),
      };
    }),
    ...fields.map((definition) => ({
      dataset,
      section: "fields" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.level.gribLevel,
      temporalSemantics: definition.temporalSemantics,
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
    ...Object.values(LAYER_DIAGNOSTIC_CATALOG).map((definition) =>
      diagnosticEntry(dataset, "layer_diagnostics", definition)),
    ...Object.values(PROFILE_DIAGNOSTIC_CATALOG).map((definition) =>
      diagnosticEntry(dataset, "profile_diagnostics", definition)),
  ];
}


function aromeEntries(): CatalogEntry[] {
  return AROME_0P01_FIELD_IDS.map((id) => {
    const definition = aromeFieldDefinition(id);
    return {
      dataset: "arome" as const,
      section: "fields" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.level.gribLevel,
      temporalSemantics: definition.temporalSemantics,
      outputs: definition.outputs.map((output) => ({ ...output })),
    };
  });
}

function peAromeEntries(): CatalogEntry[] {
  return PE_AROME_FIELD_IDS.map((id) => {
    const definition = NON_ISOBARIC_FIELD_CATALOG[id];
    return {
      dataset: "pe-arome" as const,
      section: "fields" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.level.gribLevel,
      temporalSemantics: definition.temporalSemantics,
      outputs: definition.outputs.map((output) => ({ ...output })),
    };
  });
}

function iconD2Entries(
  dataset: "icon-d2" | "icon-d2-eps",
): CatalogEntry[] {
  const fields = ICON_D2_FIELD_IDS.map((id) => iconD2FieldDefinition(id));
  return [
    ...ICON_D2_PRESSURE_VARIABLE_IDS.map((id) => {
      const definition = VARIABLE_CATALOG[id];
      return {
        dataset,
        section: "variables" as const,
        id,
        classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
        kind: definition.kind,
        description: definition.description,
        verticalSemantics: definition.levelType,
        outputs: definition.outputs.map((output) => ({ ...output })),
      };
    }),
    ...fields.map((definition) => ({
      dataset,
      section: "fields" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.level.gribLevel,
      temporalSemantics: definition.temporalSemantics,
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
    ...Object.values(LAYER_DIAGNOSTIC_CATALOG).map((definition) =>
      diagnosticEntry(dataset, "layer_diagnostics", definition)),
    ...Object.values(PROFILE_DIAGNOSTIC_CATALOG).map((definition) =>
      diagnosticEntry(dataset, "profile_diagnostics", definition)),
  ];
}

function gfsEntries(): CatalogEntry[] {
  const catalog = getGfsPressureCatalog();
  return [
    ...catalog.variables.map((definition) => ({
      dataset: "gfs" as const,
      section: "variables" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.levelType,
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
    ...catalog.fields.map((definition) => ({
      dataset: "gfs" as const,
      section: "fields" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.level.gribLevel,
      temporalSemantics: definition.temporalSemantics,
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
    ...catalog.layerDiagnostics.map((definition) => diagnosticEntry("gfs", "layer_diagnostics", definition)),
    ...catalog.profileDiagnostics.map((definition) => diagnosticEntry("gfs", "profile_diagnostics", definition)),
    ...catalog.parcelDefinitions.map((definition) => ({
      dataset: "gfs" as const,
      section: "parcel_definitions" as const,
      id: definition.id,
      classification: "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: "parcel_profile",
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
  ];
}

function gefsEntries(): CatalogEntry[] {
  const catalog = getGefsCatalog();
  return [
    ...catalog.variables.map((definition) => ({
      dataset: "gefs" as const,
      section: "variables" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.levelType,
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
    ...catalog.fields.map((definition) => ({
      dataset: "gefs" as const,
      section: "fields" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.level.gribLevel,
      temporalSemantics: definition.temporalSemantics,
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
    ...catalog.layerDiagnostics.map((definition) => diagnosticEntry("gefs", "layer_diagnostics", definition)),
    ...catalog.profileDiagnostics.map((definition) => diagnosticEntry("gefs", "profile_diagnostics", definition)),
    ...catalog.parcelDefinitions.map((definition) => ({
      dataset: "gefs" as const,
      section: "parcel_definitions" as const,
      id: definition.id,
      classification: "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: "parcel_profile",
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
  ];
}

export function gefsReforecastEntries(): CatalogEntry[] {
  const catalog = getGefsCatalog();
  const fields = new Set<string>(GEFS_REFORECAST_FIELD_IDS);
  return [
    ...GEFS_REFORECAST_PRESSURE_VARIABLE_IDS.map((id) => {
      const definition = VARIABLE_CATALOG[id];
      return {
        dataset: "gefs" as const,
        section: "variables" as const,
        id,
        classification: "raw" as const,
        kind: "raw",
        description: definition.description,
        verticalSemantics: definition.levelType,
        outputs: definition.outputs.map((output) => ({ ...output })),
      };
    }),
    ...catalog.fields
      .filter((definition) => fields.has(definition.id))
      .map((definition) => ({
        dataset: "gefs" as const,
        section: "fields" as const,
        id: definition.id,
        classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
        kind: definition.kind,
        description: definition.description,
        verticalSemantics: definition.level.gribLevel,
        temporalSemantics: definition.temporalSemantics,
        outputs: definition.outputs.map((output) => ({ ...output })),
      })),
    ...catalog.layerDiagnostics.map((definition) =>
      diagnosticEntry("gefs", "layer_diagnostics", definition)),
    ...catalog.profileDiagnostics.map((definition) =>
      diagnosticEntry("gefs", "profile_diagnostics", definition)),
  ];
}

function aifsEntries(dataset: "aifs" | "aifs-ens"): CatalogEntry[] {
  const catalog = getAifsCatalog();
  return [
    ...catalog.variables.map((definition) => ({
      dataset,
      section: "variables" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.levelType,
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
    ...catalog.fields.map((definition) => ({
      dataset,
      section: "fields" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.verticalSemantics,
      temporalSemantics: definition.temporalSemantics,
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
    ...Object.values(LAYER_DIAGNOSTIC_CATALOG).map((definition) =>
      diagnosticEntry(dataset, "layer_diagnostics", definition)),
    ...Object.values(PROFILE_DIAGNOSTIC_CATALOG).map((definition) =>
      diagnosticEntry(dataset, "profile_diagnostics", definition)),
  ];
}

function ifsEntries(dataset: "ifs" | "ifs-ens"): CatalogEntry[] {
  const catalog = getIfsCatalog();
  return [
    ...catalog.variables.map((definition) => ({
      dataset,
      section: "variables" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.levelType,
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
    ...catalog.fields.map((definition) => ({
      dataset,
      section: "fields" as const,
      id: definition.id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.verticalSemantics,
      temporalSemantics: definition.temporalSemantics,
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
    ...Object.values(LAYER_DIAGNOSTIC_CATALOG).map((definition) =>
      diagnosticEntry(dataset, "layer_diagnostics", definition)),
    ...Object.values(PROFILE_DIAGNOSTIC_CATALOG).map((definition) =>
      diagnosticEntry(dataset, "profile_diagnostics", definition)),
    ...Object.values(PARCEL_DIAGNOSTIC_CATALOG).map((definition) => ({
      dataset,
      section: "parcel_definitions" as const,
      id: definition.id,
      classification: "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: "parcel_profile",
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
  ];
}

function historyEntries(): CatalogEntry[] {
  const variables = HISTORICAL_GFS_VARIABLE_IDS.map((id) => {
    const definition = VARIABLE_CATALOG[id];
    return {
      dataset: "gfs-analysis" as const,
      section: "variables" as const,
      id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.levelType,
      outputs: definition.outputs.map((output: { field: string; unit: string; description?: string }) => ({ ...output })),
    };
  });

  const fields = HISTORICAL_GFS_FIELD_IDS.map((id) => {
    const definition = (NON_ISOBARIC_FIELD_CATALOG as Record<string, any>)[id];
    if (definition === undefined) {
      return {
        dataset: "gfs-analysis" as const,
        section: "fields" as const,
        id,
        classification: "raw" as const,
        kind: "raw_field",
        description: `Historical GFS Grid 4 analysis field ${id}`,
        verticalSemantics: "historical_grid4_field",
        temporalSemantics: "instantaneous" as const,
        outputs: [],
      };
    }
    return {
      dataset: "gfs-analysis" as const,
      section: "fields" as const,
      id,
      classification: definition.kind === "raw" ? "raw" as const : "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: definition.level.gribLevel,
      temporalSemantics: "instantaneous" as const,
      outputs: definition.outputs.map((output: { field: string; unit: string; description?: string }) => ({ ...output })),
    };
  });

  return [
    ...variables,
    ...fields,
    ...Object.values(LAYER_DIAGNOSTIC_CATALOG).map((definition) =>
      diagnosticEntry("gfs-analysis", "layer_diagnostics", definition)),
    ...Object.values(PROFILE_DIAGNOSTIC_CATALOG).map((definition) =>
      diagnosticEntry("gfs-analysis", "profile_diagnostics", definition)),
    ...Object.values(PARCEL_DIAGNOSTIC_CATALOG).map((definition) => ({
      dataset: "gfs-analysis" as const,
      section: "parcel_definitions" as const,
      id: definition.id,
      classification: "derived" as const,
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: "parcel_profile",
      outputs: definition.outputs.map((output) => ({ ...output })),
    })),
  ];
}

function diagnosticEntry(
  dataset: PublicAtmosphericDataset,
  section: "layer_diagnostics" | "profile_diagnostics",
  definition: {
    id: string;
    kind: string;
    description: string;
    verticalSemantics: string;
    outputs: ReadonlyArray<{ field: string; unit: string; description?: string }>;
  },
): CatalogEntry {
  return {
    dataset,
    section,
    id: definition.id,
    classification: "derived",
    kind: definition.kind,
    description: definition.description,
    verticalSemantics: definition.verticalSemantics,
    outputs: definition.outputs.map((output) => ({ ...output })),
  };
}

