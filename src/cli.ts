#!/usr/bin/env node
import { Command } from "commander";
import { getGfsPressureCatalog } from "./catalog/catalog.js";
import { searchGfsCatalog } from "./catalog/search.js";
import {
  catalogSearchResultSchema,
  type CatalogSearchSection,
} from "./schema/catalog-search.js";

if (process.argv[2] === "transect") {
  await import("./transect-cli.js");
} else if (process.argv[2] !== "catalog") {
  await import("./cli-legacy.js");
} else {
  const command = new Command("catalog")
    .description("Browse or search supported GFS variables, diagnostics, parcel definitions, and non-isobaric fields")
    .option("--search <text>", "Search IDs, descriptions, dependencies, outputs, units, GFS codes, and semantics")
    .option("--sections <list>", "Comma-separated sections: variables,fields,layer_diagnostics,profile_diagnostics,parcel_definitions")
    .option("--classification <raw|derived>", "Restrict matches to raw or derived entries")
    .option("--temporal <instantaneous|accumulation|average>", "Restrict non-isobaric fields by temporal semantics")
    .option("--limit <number>", "Maximum compact search results (1-100)", Number)
    .option("--json", "Output JSON")
    .action((options) => {
      const searchMode = options.search !== undefined
        || options.sections !== undefined
        || options.classification !== undefined
        || options.temporal !== undefined
        || options.limit !== undefined;

      if (!searchMode) {
        const catalog = getGfsPressureCatalog();
        if (options.json) {
          console.log(JSON.stringify(catalog, null, 2));
          return;
        }
        printFullCatalog(catalog);
        return;
      }

      const result = catalogSearchResultSchema.parse(searchGfsCatalog({
        ...(options.search === undefined ? {} : { search: String(options.search) }),
        ...(options.sections === undefined ? {} : { sections: parseSections(options.sections) }),
        ...(options.classification === undefined ? {} : { classification: options.classification }),
        ...(options.temporal === undefined ? {} : { temporalSemantics: options.temporal }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      }));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const searchText = result.query.search === undefined ? "browse" : `search=${JSON.stringify(result.query.search)}`;
      console.log(`GFS catalog ${searchText}; ${result.totalMatches} matches${result.truncated ? `, showing ${result.matches.length}` : ""}`);
      console.table(result.matches.map((match) => ({
        section: match.section,
        id: match.id,
        classification: match.classification,
        temporal: match.temporalSemantics ?? "",
        vertical: match.verticalSemantics,
        gfs: match.gfsCode ?? "",
        output: match.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
      })));
    });

  await command.parseAsync(process.argv.slice(3), { from: "user" });
}

function printFullCatalog(catalog: ReturnType<typeof getGfsPressureCatalog>): void {
  console.log("Pressure-level variables");
  console.table(catalog.variables.map((variable) => ({
    id: variable.id,
    kind: variable.kind,
    gfs: "gfsCode" in variable ? variable.gfsCode : "derived",
    output: variable.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
  })));
  console.log(`Pressure levels (hPa): ${catalog.pressureLevelsHpa.join(", ")}`);
  console.log("Pressure-layer diagnostics");
  console.table(catalog.layerDiagnostics.map((diagnostic) => ({
    id: diagnostic.id,
    dependencies: diagnostic.dependencies.join(", "),
    output: diagnostic.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
  })));
  console.log("Whole-profile diagnostics");
  console.table(catalog.profileDiagnostics.map((diagnostic) => ({
    id: diagnostic.id,
    dependencies: diagnostic.dependencies.join(", "),
    output: diagnostic.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
  })));
  console.log("Parcel definitions");
  console.table(catalog.parcelDefinitions.map((definition) => ({
    id: definition.id,
    pressureDependencies: definition.pressureDependencies.join(", "),
    fieldDependencies: definition.fieldDependencies.join(", "),
    output: definition.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
  })));
  console.log("Non-isobaric fields");
  console.table(catalog.fields.map((field) => ({
    id: field.id,
    kind: field.kind,
    level: formatFieldLevel(field.level),
    temporal: field.temporalSemantics,
    gfs: "gfsCode" in field ? field.gfsCode : "derived",
    output: field.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
  })));
}

function formatFieldLevel(level: ReturnType<typeof getGfsPressureCatalog>["fields"][number]["level"]): string {
  switch (level.type) {
    case "surface": return "surface";
    case "height_above_ground_m": return `${level.heightM} m AGL`;
    case "named_layer": return level.id.replaceAll("_", " ");
    case "named_level": return level.id.replaceAll("_", " ");
  }
}

function parseSections(value: unknown): CatalogSearchSection[] {
  return String(value)
    .split(",")
    .map((section) => section.trim())
    .filter(Boolean) as CatalogSearchSection[];
}
