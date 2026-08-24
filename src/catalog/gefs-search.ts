import {
  catalogSearchQuerySchema,
  type CatalogSearchMatch,
  type CatalogSearchQueryInput,
  type CatalogSearchResult,
  type CatalogSearchSection,
} from "../schema/catalog-search.js";
import { getGefsCatalog } from "./gefs-catalog.js";

const ALL_SECTIONS: CatalogSearchSection[] = [
  "variables",
  "fields",
  "layer_diagnostics",
  "profile_diagnostics",
  "parcel_definitions",
];
const SECTION_ORDER = new Map(ALL_SECTIONS.map((section, index) => [section, index]));

interface SearchableEntry extends Omit<CatalogSearchMatch, "score"> {
  searchParts: string[];
}

export function searchGefsCatalog(input: CatalogSearchQueryInput = {}): CatalogSearchResult {
  const query = catalogSearchQuerySchema.parse(input);
  const sections = query.sections ?? ALL_SECTIONS;
  const allowed = new Set(sections);
  const entries = buildEntries().filter((entry) => {
    if (!allowed.has(entry.section)) return false;
    if (query.classification !== undefined && entry.classification !== query.classification) return false;
    if (query.temporalSemantics !== undefined && entry.temporalSemantics !== query.temporalSemantics) return false;
    return true;
  });

  const scored = entries
    .map((entry) => {
      const score = searchScore(entry, query.search);
      return score === null ? null : { entry, score };
    })
    .filter((value): value is { entry: SearchableEntry; score: number } => value !== null)
    .sort((left, right) =>
      right.score - left.score
      || (SECTION_ORDER.get(left.entry.section) ?? 99) - (SECTION_ORDER.get(right.entry.section) ?? 99)
      || left.entry.id.localeCompare(right.entry.id));

  const matches = scored.slice(0, query.limit).map(({ entry, score }) => ({
    section: entry.section,
    id: entry.id,
    classification: entry.classification,
    kind: entry.kind,
    description: entry.description,
    verticalSemantics: entry.verticalSemantics,
    ...(entry.temporalSemantics === undefined ? {} : { temporalSemantics: entry.temporalSemantics }),
    ...(entry.gfsCode === undefined ? {} : { gfsCode: entry.gfsCode }),
    ...(entry.sourceUnit === undefined ? {} : { sourceUnit: entry.sourceUnit }),
    ...(entry.dependencies === undefined ? {} : { dependencies: [...entry.dependencies] }),
    outputs: entry.outputs.map((output) => ({ ...output })),
    score,
  }));

  return {
    model: "gefs_0p50",
    query: {
      ...(query.search === undefined ? {} : { search: query.search }),
      sections: [...sections],
      ...(query.classification === undefined ? {} : { classification: query.classification }),
      ...(query.temporalSemantics === undefined ? {} : { temporalSemantics: query.temporalSemantics }),
      limit: query.limit,
    },
    totalMatches: scored.length,
    truncated: scored.length > query.limit,
    matches,
  };
}

function buildEntries(): SearchableEntry[] {
  const catalog = getGefsCatalog();
  const variables: SearchableEntry[] = catalog.variables.map((definition) => ({
    section: "variables",
    id: definition.id,
    classification: definition.kind === "raw" ? "raw" : "derived",
    kind: definition.kind,
    description: definition.description,
    verticalSemantics: `${definition.levelType}: ${definition.supportedPressureLevelsHpa.join(",")} hPa`,
    ...( "gfsCode" in definition
      ? { gfsCode: definition.gfsCode, sourceUnit: definition.sourceUnit }
      : { dependencies: [...definition.dependencies] }),
    outputs: definition.outputs.map((output) => ({ ...output })),
    searchParts: "gfsCode" in definition
      ? [definition.gfsCode, definition.sourceUnit, ...definition.supportedPressureLevelsHpa.map(String)]
          .filter((value): value is string => value !== undefined)
      : [...definition.dependencies, ...definition.supportedPressureLevelsHpa.map(String)],
  }));

  const fields: SearchableEntry[] = catalog.fields.map((definition) => ({
    section: "fields",
    id: definition.id,
    classification: definition.kind === "raw" ? "raw" : "derived",
    kind: definition.kind,
    description: definition.description,
    verticalSemantics: definition.level.gribLevel,
    temporalSemantics: definition.temporalSemantics,
    ...("gfsCode" in definition
      ? { gfsCode: definition.gfsCode, sourceUnit: definition.sourceUnit }
      : { dependencies: [...definition.dependencies] }),
    outputs: definition.outputs.map((output) => ({ ...output })),
    searchParts: "gfsCode" in definition
      ? [definition.gfsCode, definition.sourceUnit, definition.level.description].filter((value): value is string => value !== undefined)
      : [...definition.dependencies, definition.level.description],
  }));

  const layerDiagnostics: SearchableEntry[] = catalog.layerDiagnostics.map((definition) => ({
    section: "layer_diagnostics",
    id: definition.id,
    classification: "derived",
    kind: definition.kind,
    description: definition.description,
    verticalSemantics: definition.verticalSemantics,
    dependencies: [...definition.dependencies],
    outputs: definition.outputs.map((output) => ({ ...output })),
    searchParts: [...definition.dependencies],
  }));

  const profileDiagnostics: SearchableEntry[] = catalog.profileDiagnostics.map((definition) => ({
    section: "profile_diagnostics",
    id: definition.id,
    classification: "derived",
    kind: definition.kind,
    description: definition.description,
    verticalSemantics: definition.verticalSemantics,
    dependencies: [...definition.dependencies],
    outputs: definition.outputs.map((output) => ({ ...output })),
    searchParts: [...definition.dependencies],
  }));

  const parcelDefinitions: SearchableEntry[] = catalog.parcelDefinitions.map((definition) => {
    const dependencies = [
      ...definition.pressureDependencies,
      ...definition.fieldDependencies,
      ...definition.staticDependencies,
    ];
    return {
      section: "parcel_definitions",
      id: definition.id,
      classification: "derived",
      kind: definition.kind,
      description: definition.description,
      verticalSemantics: "explicit sampled GEFS pressure profile plus member-specific surface state and same-cycle f000 model orography",
      dependencies,
      outputs: definition.outputs.map((output) => ({ ...output })),
      searchParts: dependencies,
    };
  });

  return [...variables, ...fields, ...layerDiagnostics, ...profileDiagnostics, ...parcelDefinitions];
}

function searchScore(entry: SearchableEntry, rawSearch: string | undefined): number | null {
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
    entry.gfsCode,
    entry.sourceUnit,
    ...(entry.dependencies ?? []),
    ...entry.outputs.flatMap((output) => [output.field, output.unit, output.description ?? ""]),
    ...entry.searchParts,
  ].filter((value): value is string => value !== undefined).join(" "));
  const haystack = `${id} ${description} ${structured}`;
  if (!tokens.every((token) => haystack.includes(token))) return null;

  let score = 0;
  if (id === search) score += 1_000;
  else if (id.startsWith(search)) score += 600;
  else if (id.includes(search)) score += 400;
  const idTokens = new Set(id.split(" "));
  for (const token of tokens) {
    if (idTokens.has(token)) score += 100;
    else if (id.includes(token)) score += 60;
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
