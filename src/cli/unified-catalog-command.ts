import type { Command } from "commander";
import { searchAtmosphereCatalog } from "../catalog/unified-search.js";
import {
  UNIFIED_CATALOG_SECTIONS,
  type UnifiedCatalogResult,
} from "../schema/unified-catalog.js";
import {
  PUBLIC_ATMOSPHERIC_DATASET_IDS,
  publicAtmosphericDatasetSchema,
  type PublicAtmosphericDataset,
} from "../schema/unified-api.js";

type UnifiedSection = (typeof UNIFIED_CATALOG_SECTIONS)[number];

export function registerCatalogCommand(program: Command): void {
  program
    .command("catalog")
    .description("Search atmospheric variables, fields, diagnostics, and dataset support")
    .option(`--dataset <${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")}|all>`, "Dataset filter", "all")
    .option("--search <text>", "Search catalog text")
    .option("--sections <list>", "Comma-separated catalog sections")
    .option("--classification <raw|derived>", "Raw or derived entries")
    .option("--temporal <instantaneous|accumulation|average>", "Temporal semantics")
    .option("--limit <number>", "Maximum matches", Number, 30)
    .option("--json", "Output JSON")
    .action((options) => {
      const dataset = parseDataset(options.dataset);
      const result = searchAtmosphereCatalog({
        ...(options.search === undefined ? {} : { search: String(options.search) }),
        ...(dataset === "all" ? {} : { datasets: [dataset] }),
        ...(options.sections === undefined ? {} : { sections: parseSections(options.sections) }),
        ...(options.classification === undefined ? {} : { classification: options.classification }),
        ...(options.temporal === undefined ? {} : { temporalSemantics: options.temporal }),
        limit: options.limit,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      printCatalog(result);
    });
}

function parseDataset(value: unknown): PublicAtmosphericDataset | "all" {
  const dataset = String(value).trim().toLowerCase();
  if (dataset === "all") return "all";
  const parsed = publicAtmosphericDatasetSchema.safeParse(dataset);
  if (parsed.success) return parsed.data;
  throw new Error(
    `Expected --dataset ${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")}|all, received: ${value}`,
  );
}

function parseSections(value: unknown): UnifiedSection[] {
  const sections = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = sections.filter((item) => !(UNIFIED_CATALOG_SECTIONS as readonly string[]).includes(item));
  if (invalid.length > 0) {
    throw new Error(`Unknown catalog sections: ${invalid.join(", ")}`);
  }
  return sections as UnifiedSection[];
}

function printCatalog(result: UnifiedCatalogResult): void {
  console.log(`Atmospheric catalog: ${result.totalMatches} canonical matches${result.truncated ? `, showing ${result.matches.length}` : ""}`);
  console.table(result.matches.map((match) => ({
    section: match.section,
    id: match.id,
    classification: match.classification,
    datasets: match.support.map((item) => item.dataset).join(","),
    temporal: match.temporalSemantics ?? "",
    output: match.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
  })));
}
