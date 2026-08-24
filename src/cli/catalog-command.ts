import type { Command } from "commander";
import { getGfsPressureCatalog } from "../catalog/catalog.js";
import { getGefsCatalog } from "../catalog/gefs-catalog.js";
import { searchGefsCatalog } from "../catalog/gefs-search.js";
import { searchGfsCatalog } from "../catalog/search.js";
import {
  catalogSearchResultSchema,
  type CatalogSearchSection,
} from "../schema/catalog-search.js";
import { parseAtmosphericModel } from "./shared.js";

export function registerCatalogCommand(program: Command): void {
  program
    .command("catalog")
    .description("Browse or search supported GFS or GEFS variables, diagnostics, parcel definitions, and fields")
    .option("--model <gfs|gefs>", "Atmospheric model family", "gfs")
    .option("--search <text>", "Search IDs, descriptions, dependencies, outputs, units, GRIB codes, and semantics")
    .option("--sections <list>", "Comma-separated sections: variables,fields,layer_diagnostics,profile_diagnostics,parcel_definitions")
    .option("--classification <raw|derived>", "Restrict matches to raw or derived entries")
    .option("--temporal <instantaneous|accumulation|average>", "Restrict non-isobaric fields by temporal semantics")
    .option("--limit <number>", "Maximum compact search results (1-100)", Number)
    .option("--json", "Output JSON")
    .action((options) => {
      const model = parseAtmosphericModel(options.model);
      const searchMode = options.search !== undefined
        || options.sections !== undefined
        || options.classification !== undefined
        || options.temporal !== undefined
        || options.limit !== undefined;

      if (!searchMode) {
        if (model === "gfs") {
          const catalog = getGfsPressureCatalog();
          if (options.json) return console.log(JSON.stringify(catalog, null, 2));
          printGfsCatalog(catalog);
          return;
        }
        const catalog = getGefsCatalog();
        if (options.json) return console.log(JSON.stringify(catalog, null, 2));
        printGefsCatalog(catalog);
        return;
      }

      const query = {
        ...(options.search === undefined ? {} : { search: String(options.search) }),
        ...(options.sections === undefined ? {} : { sections: parseSections(options.sections) }),
        ...(options.classification === undefined ? {} : { classification: options.classification }),
        ...(options.temporal === undefined ? {} : { temporalSemantics: options.temporal }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      };
      const result = catalogSearchResultSchema.parse(
        model === "gfs" ? searchGfsCatalog(query) : searchGefsCatalog(query),
      );

      if (options.json) return console.log(JSON.stringify(result, null, 2));

      const searchText = result.query.search === undefined ? "browse" : `search=${JSON.stringify(result.query.search)}`;
      console.log(`${model.toUpperCase()} catalog ${searchText}; ${result.totalMatches} matches${result.truncated ? `, showing ${result.matches.length}` : ""}`);
      console.table(result.matches.map((match) => ({
        section: match.section,
        id: match.id,
        classification: match.classification,
        temporal: match.temporalSemantics ?? "",
        vertical: match.verticalSemantics,
        grib: match.gfsCode ?? "",
        output: match.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
      })));
    });
}

function printGfsCatalog(catalog: ReturnType<typeof getGfsPressureCatalog>): void {
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
    level: formatGfsFieldLevel(field.level),
    temporal: field.temporalSemantics,
    gfs: "gfsCode" in field ? field.gfsCode : "derived",
    output: field.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
  })));
}

function printGefsCatalog(catalog: ReturnType<typeof getGefsCatalog>): void {
  console.log(`GEFS ${catalog.product}; ${catalog.members} members`);
  console.log("Pressure-profile variables");
  console.table(catalog.variables.map((variable) => ({
    id: variable.id,
    kind: variable.kind,
    grib: "gfsCode" in variable ? variable.gfsCode : "derived",
    levelsHpa: variable.supportedPressureLevelsHpa.join(","),
    dependencies: "dependencies" in variable ? variable.dependencies.join(", ") : "",
    output: variable.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
  })));
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
    staticDependencies: definition.staticDependencies.join(", "),
    output: definition.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
  })));
  console.log("GEFS pgrb2a non-isobaric fields");
  console.table(catalog.fields.map((field) => ({
    id: field.id,
    kind: field.kind,
    level: field.level.description,
    temporal: field.temporalSemantics,
    grib: "gfsCode" in field ? field.gfsCode : "derived",
    output: field.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
  })));
  console.log(catalog.fieldSemanticsNote);
  console.log(catalog.parcelDiagnosticsNote);
}

function formatGfsFieldLevel(level: ReturnType<typeof getGfsPressureCatalog>["fields"][number]["level"]): string {
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
