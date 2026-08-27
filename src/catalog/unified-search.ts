import { getGefsCatalog } from "./gefs-catalog.js";
import { getGfsPressureCatalog } from "./catalog.js";
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
import type { PublicAtmosphericDataset } from "../schema/unified-api.js";

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
  temporalSemantics?: "instantaneous" | "accumulation" | "average";
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
  const datasets = new Set(query.datasets);

  const entries = [
    ...(datasets.has("gfs") ? gfsEntries() : []),
    ...(datasets.has("gefs") ? gefsEntries() : []),
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
          ? { temporalSemantics: [...temporalValues][0] as "instantaneous" | "accumulation" | "average" }
          : {}),
        outputs: representative.outputs.map((output) => ({ ...output })),
        support: group
          .sort((a, b) => query.datasets.indexOf(a.dataset) - query.datasets.indexOf(b.dataset))
          .map((entry) => ({
            dataset: entry.dataset,
            semantics: supportSemantics(entry.dataset),
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
    totalMatches: matches.length,
    truncated: matches.length > query.limit,
    matches: limited,
  });
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
      outputs: definition.outputs.map((output) => ({ ...output })),
    };
  });

  const fields = HISTORICAL_GFS_FIELD_IDS.map((id) => {
    const definition = NON_ISOBARIC_FIELD_CATALOG[id];
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
      outputs: definition.outputs.map((output) => ({ ...output })),
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
    outputs: readonly Array<{ field: string; unit: string; description?: string }>;
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
    ?? entries.find((entry) => entry.dataset === "gefs")
    ?? entries[0]!;
}

function supportSemantics(dataset: PublicAtmosphericDataset): string {
  switch (dataset) {
    case "gfs":
      return "deterministic operational forecast";
    case "gefs":
      return "member-first ensemble forecast distribution";
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
