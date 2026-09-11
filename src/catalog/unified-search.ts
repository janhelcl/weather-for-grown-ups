import {
  CATALOG_ENTRY_FACTORIES,
  gefsReforecastEntries,
  type CatalogEntry,
  type UnifiedSection,
} from "./unified-entries.js";
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

  const search = query.search === undefined ? undefined : normalize(query.search);
  const tokens = search?.split(" ").filter(Boolean) ?? [];
  const grouped = new Map<string, Array<{ entry: CatalogEntry; score: number }>>();
  for (const dataset of Object.keys(CATALOG_ENTRY_FACTORIES) as PublicAtmosphericDataset[]) {
    if (!datasets.has(dataset)) continue;
    for (const indexed of datasetIndex(dataset, query.forecastKind)) {
      const { entry } = indexed;
      if (!sections.has(entry.section)) continue;
      if (query.classification !== undefined && entry.classification !== query.classification) continue;
      if (query.temporalSemantics !== undefined && entry.temporalSemantics !== query.temporalSemantics) continue;
      const score = searchScore(indexed, search, tokens);
      if (score === null) continue;
      const key = `${entry.section}:${entry.id}`;
      const group = grouped.get(key) ?? [];
      group.push({ entry, score });
      grouped.set(key, group);
    }
  }

  const matches = [...grouped.values()]
    .map((group) => {
      const representative = group[0]!.entry;
      const score = Math.max(...group.map((match) => match.score));
      const temporalValues = new Set(group.map(({ entry }) => entry.temporalSemantics).filter(Boolean));
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
          .sort((a, b) => query.datasets.indexOf(a.entry.dataset) - query.datasets.indexOf(b.entry.dataset))
          .map(({ entry }) => ({
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

  const offset = query.offset ?? 0;
  const limited = matches.slice(offset, offset + query.limit);
  const nextOffset = offset + limited.length;
  const truncated = nextOffset < matches.length;
  return unifiedCatalogResultSchema.parse({
    query,
    datasetCapabilities: eligibleDatasets.map((dataset) =>
      publicDatasetCapabilities(dataset, query.forecastKind)),
    totalMatches: matches.length,
    truncated,
    ...(truncated ? { nextOffset } : {}),
    matches: limited,
  });
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

interface IndexedEntry {
  entry: CatalogEntry;
  id: string;
  description: string;
  structured: string;
  haystack: string;
}

// Finite inventory cache: one entry per public dataset, plus GEFS reforecast.
// No query strings or results are retained, even in long-running MCP servers.
const indexes = new Map<string, readonly IndexedEntry[]>();

function datasetIndex(
  dataset: PublicAtmosphericDataset,
  forecastKind: "operational" | "reforecast" | undefined,
): readonly IndexedEntry[] {
  const reforecast = dataset === "gefs" && forecastKind === "reforecast";
  const key = reforecast ? "gefs:reforecast" : dataset;
  let index = indexes.get(key);
  if (index === undefined) {
    const entries = reforecast ? gefsReforecastEntries() : CATALOG_ENTRY_FACTORIES[dataset]();
    index = entries.map(indexEntry);
    indexes.set(key, index);
  }
  return index;
}

function indexEntry(entry: CatalogEntry): IndexedEntry {
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
  return { entry, id, description, structured, haystack };
}

function searchScore(entry: IndexedEntry, search: string | undefined, tokens: string[]): number | null {
  if (search === undefined) return 0;
  const { id, description, structured, haystack } = entry;
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
