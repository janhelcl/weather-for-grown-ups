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
import {
  searchAtmosphereCatalogSchema,
  unifiedCatalogResultSchema,
  type SearchAtmosphereCatalogInput,
  type UnifiedCatalogResult,
} from "../schema/unified-catalog.js";
import {
  publicDatasetCapabilities,
  publicDatasetCoversGeometry,
  type PublicAtmosphericDataset,
} from "../schema/unified-api.js";

type UnifiedSection =
  | "variables"
  | "fields"
  | "layer_diagnostics"
  | "profile_diagnostics"
  | "parcel_definitions";

interface CatalogEntry {
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

const SECTION_ORDER: Record<UnifiedSection, number> = {
  variables: 0,
  fields: 1,
  layer_diagnostics: 2,
  profile_diagnostics: 3,
  parcel_definitions: 4,
};

export function searchAtmosphereCatalog(input: SearchAtmosphereCatalogInput = {}): UnifiedCatalogResult {
  const query = searchAtmosphereCatalogSchema.parse(input);
  const sections = new Set<UnifiedSection>(
    query.sections ?? ["variables", "fields", "layer_diagnostics", "profile_diagnostics", "parcel_definitions"],
  );
  const eligibleDatasets = query.datasets.filter((dataset) => {
    const capability = publicDatasetCapabilities(dataset, query.forecastKind);
    if (
      query.spatialScope !== undefined
      && capability.spatialDomain.scope !== query.spatialScope
    ) {
      return false;
    }
    if (
      query.coverage !== undefined
      && !publicDatasetCoversGeometry(dataset, query.coverage)
    ) {
      return false;
    }
    return true;
  });
  const datasets = new Set(eligibleDatasets);

  const entries = [
    ...(datasets.has("gfs") ? gfsEntries() : []),
    ...(datasets.has("aigfs") ? aigfsEntries("aigfs") : []),
    ...(datasets.has("aigefs") ? aigfsEntries("aigefs") : []),
    ...(datasets.has("hgefs") ? aigfsEntries("hgefs") : []),
    ...(datasets.has("icon-d2") ? iconD2Entries("icon-d2") : []),
    ...(datasets.has("icon-d2-eps") ? iconD2Entries("icon-d2-eps") : []),
    ...(datasets.has("arome") ? aromeEntries() : []),
    ...(datasets.has("pe-arome") ? peAromeEntries() : []),
    ...(datasets.has("gefs")
      ? (query.forecastKind === "reforecast" ? gefsReforecastEntries() : gefsEntries())
      : []),
    ...(datasets.has("ifs") ? ifsEntries("ifs") : []),
    ...(datasets.has("aifs") ? aifsEntries("aifs") : []),
    ...(datasets.has("aifs-ens") ? aifsEntries("aifs-ens") : []),
    ...(datasets.has("ifs-ens") ? ifsEntries("ifs-ens") : []),
    ...(datasets.has("gfs-analysis") ? historyEntries() : []),
  ].filter((entry) => {
    if (!sections.has(entry.section)) return false;
    if (query.classification !== undefined && entry.classification !== query.classification) return false;
    if (query.temporalSemantics !== undefined && entry.temporalSemantics !== query.temporalSemantics) return false;
    return searchScore(entry, query.search) !== null;
  });

  const grouped = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const key = `${entry.section}:${entry.id}`;
    const group = grouped.get(key) ?? [];
    group.push(entry);
    grouped.set(key, group);
  }

  const matches = [...grouped.values()]
    .map((group) => {
      const representative = preferredRepresentative(group);
      const score = Math.max(...group.map((entry) => searchScore(entry, query.search) ?? 0));
      const temporalValues = new Set(group.map((entry) => entry.temporalSemantics).filter(Boolean));
      return {
        section: representative.section,
        id: representative.id,
        classification: representative.classification,
        kind: representative.kind,
        description: representative.description,
        verticalSemantics: representative.verticalSemantics,
        ...(temporalValues.size === 1
          ? { temporalSemantics: [...temporalValues][0] as "instantaneous" | "accumulation" | "average" | "maximum" }
          : {}),
        outputs: representative.outputs.map((output) => ({ ...output })),
        support: group
          .sort((a, b) => query.datasets.indexOf(a.dataset) - query.datasets.indexOf(b.dataset))
          .map((entry) => ({
            dataset: entry.dataset,
            semantics: supportSemantics(entry.dataset, query.forecastKind),
          })),
        score,
      };
    })
    .sort((a, b) =>
      b.score - a.score
      || SECTION_ORDER[a.section] - SECTION_ORDER[b.section]
      || a.id.localeCompare(b.id));

  const limited = matches.slice(0, query.limit);
  return unifiedCatalogResultSchema.parse({
    query,
    datasetCapabilities: eligibleDatasets.map((dataset) =>
      publicDatasetCapabilities(dataset, query.forecastKind)),
    totalMatches: matches.length,
    truncated: matches.length > query.limit,
    matches: limited,
  });
}


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

function gefsReforecastEntries(): CatalogEntry[] {
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

function preferredRepresentative(entries: CatalogEntry[]): CatalogEntry {
  return entries.find((entry) => entry.dataset === "gfs")
    ?? entries.find((entry) => entry.dataset === "aigfs")
    ?? entries.find((entry) => entry.dataset === "aigefs")
    ?? entries.find((entry) => entry.dataset === "hgefs")
    ?? entries.find((entry) => entry.dataset === "icon-d2")
    ?? entries.find((entry) => entry.dataset === "icon-d2-eps")
    ?? entries.find((entry) => entry.dataset === "arome")
    ?? entries.find((entry) => entry.dataset === "pe-arome")
    ?? entries.find((entry) => entry.dataset === "gefs")
    ?? entries.find((entry) => entry.dataset === "ifs")
    ?? entries.find((entry) => entry.dataset === "aifs")
    ?? entries.find((entry) => entry.dataset === "aifs-ens")
    ?? entries.find((entry) => entry.dataset === "ifs-ens")
    ?? entries[0]!;
}

function supportSemantics(
  dataset: PublicAtmosphericDataset,
  forecastKind: "operational" | "reforecast" | undefined,
): string {
  switch (dataset) {
    case "gfs":
      return "deterministic operational forecast";
    case "aigfs":
      return "NOAA AIGFS 0.25° deterministic AI forecast; native 6-hour output cadence through 384 hours";
    case "aigefs":
      return "NOAA AIGEFS 0.25° 31-member AI ensemble; native 6-hour output cadence through 384 hours with member-first aggregation";
    case "hgefs":
      return "NOAA HGEFS 62-member hybrid ensemble composed from 31 GEFS physics members and 31 AIGEFS AI members; 6-hourly through 240 hours with constituent identity and native-grid provenance preserved";
    case "icon-d2":
      return "DWD ICON-D2 limited-area deterministic convection-permitting forecast; 3-hourly cycles, hourly output through 48 hours, with provider-native domain/grid semantics preserved";
    case "icon-d2-eps":
      return "DWD ICON-D2-EPS 20-member limited-area convection-permitting ensemble; 3-hourly cycles, hourly output through 48 hours with member-first aggregation on the native icosahedral grid";
    case "arome":
      return "Météo-France AROME limited-area deterministic forecast; ~1.3 km native model mesh with the 0.01° EURW1S100 public delivery product, hourly output through 51 hours";
    case "pe-arome":
      return "Météo-France PE-AROME 25-member limited-area ensemble; 0.025° WCS delivery grid, hourly output through 51 hours, with member-first aggregation";
    case "gefs":
      return forecastKind === "reforecast"
        ? "GEFSv12 retrospective ensemble forecast; 2000-2019 point and multi-point field, pressure, or mixed selections plus native layer/profile diagnostics; ranges preserve native cadence and per-step grid provenance"
        : "member-first ensemble forecast distribution";
    case "ifs":
      return "deterministic ECMWF IFS 0.25° operational forecast";
    case "aifs":
      return "ECMWF AIFS Single 0.25° deterministic AI forecast; four daily cycles with native 6-hour output through 360 hours";
    case "aifs-ens":
      return "ECMWF AIFS ENS 0.25° 51-member stochastic AI ensemble; dedicated control plus 50 perturbations, 6-hourly through 360 hours";
    case "ifs-ens":
      return "ECMWF IFS ENS 0.25° distribution across 50 perturbed members; deterministic IFS is the post-50r1 unperturbed control";
    case "gfs-analysis":
      return "deterministic historical model analysis; field availability may vary by model era";
  }
}

function searchScore(entry: CatalogEntry, rawSearch: string | undefined): number | null {
  if (rawSearch === undefined) return 0;
  const search = normalize(rawSearch);
  const tokens = search.split(" ").filter(Boolean);
  const id = normalize(entry.id);
  const description = normalize(entry.description);
  const structured = normalize([
    entry.section,
    entry.kind,
    entry.classification,
    entry.verticalSemantics,
    entry.temporalSemantics,
    entry.dataset,
    ...entry.outputs.flatMap((output) => [output.field, output.unit, output.description ?? ""]),
  ].filter((value): value is string => value !== undefined).join(" "));
  const haystack = `${id} ${description} ${structured}`;
  if (!tokens.every((token) => haystack.includes(token))) return null;

  let score = 0;
  if (id === search) score += 1_000;
  else if (id.startsWith(search)) score += 600;
  else if (id.includes(search)) score += 400;
  for (const token of tokens) {
    if (id.includes(token)) score += 60;
    if (description.includes(token)) score += 20;
    if (structured.includes(token)) score += 10;
  }
  return score;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9.%/+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
