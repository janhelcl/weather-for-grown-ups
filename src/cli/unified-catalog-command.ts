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
    .option("--spatial-scope <global|limited-area>", "Dataset spatial-domain filter")
    .option("--covers-point <lat,lon>", "Return only datasets covering this point")
    .option("--covers-area <west,east,south,north>", "Return only datasets fully covering this bounded area")
    .option("--forecast-kind <operational|reforecast>", "GEFS forecast population capability filter")
    .option("--limit <number>", "Maximum matches", Number, 30)
    .option("--json", "Output JSON")
    .action((options) => {
      const dataset = parseDataset(options.dataset);
      const coverage = parseCoverage(options);
      const result = searchAtmosphereCatalog({
        ...(options.search === undefined ? {} : { search: String(options.search) }),
        ...(dataset === "all" ? {} : { datasets: [dataset] }),
        ...(options.sections === undefined ? {} : { sections: parseSections(options.sections) }),
        ...(options.classification === undefined ? {} : { classification: options.classification }),
        ...(options.temporal === undefined ? {} : { temporalSemantics: options.temporal }),
        ...(options.spatialScope === undefined ? {} : { spatialScope: parseSpatialScope(options.spatialScope) }),
        ...(coverage === undefined ? {} : { coverage }),
        ...(options.forecastKind === undefined ? {} : { forecastKind: options.forecastKind }),
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

function parseSpatialScope(value: unknown): "global" | "limited_area" {
  const scope = String(value).trim().toLowerCase();
  if (scope === "global") return "global";
  if (scope === "limited-area" || scope === "limited_area") return "limited_area";
  throw new Error(`Expected --spatial-scope global|limited-area, received: ${value}`);
}

function parseCoverage(options: Record<string, any>):
  | { type: "point"; latitude: number; longitude: number }
  | {
      type: "area";
      westLongitude: number;
      eastLongitude: number;
      southLatitude: number;
      northLatitude: number;
    }
  | undefined {
  if (options.coversPoint !== undefined && options.coversArea !== undefined) {
    throw new Error("Use only one of --covers-point or --covers-area");
  }
  if (options.coversPoint !== undefined) {
    const values = parseNumberTuple(options.coversPoint, 2, "--covers-point");
    return { type: "point", latitude: values[0]!, longitude: values[1]! };
  }
  if (options.coversArea !== undefined) {
    const values = parseNumberTuple(options.coversArea, 4, "--covers-area");
    return {
      type: "area",
      westLongitude: values[0]!,
      eastLongitude: values[1]!,
      southLatitude: values[2]!,
      northLatitude: values[3]!,
    };
  }
  return undefined;
}

function parseNumberTuple(
  value: unknown,
  length: number,
  option: string,
): number[] {
  const values = String(value).split(",").map((item) => Number(item.trim()));
  if (values.length !== length || values.some((item) => !Number.isFinite(item))) {
    throw new Error(`Expected ${option} to contain ${length} comma-separated numbers, received: ${value}`);
  }
  return values;
}

function printCatalog(result: UnifiedCatalogResult): void {
  console.log("Dataset capabilities:");
  console.table(result.datasetCapabilities.map((capability) => ({
    dataset: capability.dataset,
    role: capability.role,
    kind: capability.kind,
    scope: capability.spatialDomain.scope,
    grid: capability.nativeGrid.type,
    resolution: describeResolution(capability.nativeGrid),
    horizon: capability.maxForecastHour === undefined ? "" : `f${capability.maxForecastHour}`,
    cadenceHours: capability.nativeTimeCadenceHours.join(","),
    forecastKinds: capability.forecastKinds.join(","),
    runSelectors: capability.runSelectors.join(","),
  })));
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

function describeResolution(
  grid: UnifiedCatalogResult["datasetCapabilities"][number]["nativeGrid"],
): string {
  if (grid.nominalResolution !== undefined) {
    return formatResolution(grid.nominalResolution);
  }
  return grid.components?.map((component) =>
    `${component.dataset}:${formatResolution(component.nominalResolution)}`
  ).join(" + ") ?? "";
}

function formatResolution(resolution: { value: number; unit: "degrees" | "km" }): string {
  return resolution.unit === "degrees"
    ? `${resolution.value}°`
    : `${resolution.value} km`;
}
