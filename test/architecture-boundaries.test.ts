import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createAtmosphericDiagnosticAdapterRegistry } from "../src/core/diagnostic-adapters/registry.js";
import { createAtmosphericQueryAdapterRegistry } from "../src/core/query-adapters/registry.js";
import {
  createAtmosphericAnalogAdapterRegistry,
  createAtmosphericVerificationAdapterRegistry,
} from "../src/core/specialized-adapters/registry.js";
import { PUBLIC_ATMOSPHERIC_DATASET_IDS } from "../src/schema/unified-api.js";

describe("architecture boundaries", () => {
  it("keeps one query and diagnostic adapter registered for every public atmospheric dataset", () => {
    const expected = [...PUBLIC_ATMOSPHERIC_DATASET_IDS].sort();
    expect(Object.keys(createAtmosphericQueryAdapterRegistry()).sort()).toEqual(expected);
    expect(Object.keys(createAtmosphericDiagnosticAdapterRegistry()).sort()).toEqual(expected);
  });

  it("keeps specialized operation variants behind explicit adapter registries", () => {
    expect(Object.keys(createAtmosphericVerificationAdapterRegistry()).sort()).toEqual(
      ["gfs-analysis", "igra"],
    );
    expect(Object.keys(createAtmosphericAnalogAdapterRegistry())).toEqual(["gfs-analysis"]);
  });

  it("keeps CLI and MCP on unified application services instead of dataset-specific core services", async () => {
    const [cli, mcp] = await Promise.all([
      readFile("src/cli/unified-atmosphere-command.ts", "utf8"),
      readFile("src/mcp-unified-tool.ts", "utf8"),
    ]);

    for (const surface of [cli, mcp]) {
      expect(surface).toContain("UnifiedAtmosphereQueryService");
      expect(surface).toContain("unified-atmosphere-api.js");
      expect(surface).not.toContain("unified-specialized-api.js");
      expect(surface).not.toMatch(
        /core\/(?:gfs|gefs|ifs|history|archived-gfs)-(?!unified)[^"']+\.js/,
      );
      if (surface === cli) {
        expect(surface).toContain("alignAtmosphereSchema.parse");
        expect(surface).not.toContain("parseForecastDataset");
      }
    }
  });

  it("keeps dataset-native service wiring out of the public query service", async () => {
    const service = await readFile("src/core/unified-atmosphere-query.ts", "utf8");
    expect(service).toContain("adapters?: Partial<AtmosphericQueryAdapterRegistry>");
    expect(service).not.toMatch(
      /gfsProfile|gefsBundle|gefsReforecast|ifsProfile|ifsEnsBundle|historyProfile/,
    );
  });

  it("keeps dataset-native diagnostic wiring out of the public diagnostic service", async () => {
    const service = await readFile("src/core/unified-atmosphere-diagnostics.ts", "utf8");
    expect(service).toContain("adapters?: Partial<AtmosphericDiagnosticAdapterRegistry>");
    expect(service).not.toMatch(
      /ifsEns|gefsReforecast|archivedGfs|AtmosphericLayerDiagnosticsService/,
    );
  });

  it("keeps dataset-native routing out of the public specialized services", async () => {
    const service = await readFile("src/core/unified-specialized-api.ts", "utf8");
    expect(service).toContain("specialized-adapters/registry.js");
    expect(service).toContain("adapters?: Partial<AtmosphericVerificationAdapterRegistry>");
    expect(service).not.toMatch(
      /from ["']\.\/(?:gfs|gefs|ifs|history|igra)[^"']*\.js/,
    );
    expect(service).not.toMatch(/request\.(?:dataset|referenceDataset)\s*===/);
  });

  it("keeps operation adapters above transport and decoding details", async () => {
    const files = [
      ...await tsFiles("src/core/query-adapters"),
      ...await tsFiles("src/core/diagnostic-adapters"),
      ...await tsFiles("src/core/specialized-adapters"),
    ];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(
        /from ["']\.\.\/\.\.\/(?:access|sources|cache|grib|derived)\//,
      );
    }
  });

  it("keeps alignment a composition over the public query service with no pair registry", async () => {
    const [alignment, evidence, schema] = await Promise.all([
      readFile("src/core/unified-atmosphere-alignment.ts", "utf8"),
      readFile("src/core/atmospheric-evidence.ts", "utf8"),
      readFile("src/schema/unified-alignment.ts", "utf8"),
    ]);

    // Alignment fans out through the same service every caller uses; it never touches
    // dataset-native services, providers or decoders, and never enumerates dataset pairs.
    expect(alignment).toContain("./unified-atmosphere-query.js");
    expect(alignment).toContain("mapConcurrent");
    expect(alignment).not.toMatch(/from ["']\.\/(?:gfs|gefs|ifs|aigfs|aigefs|aifs|arome|icon|history)[^"']*\.js/);
    expect(alignment).not.toMatch(/from ["']\.\.\/(?:access|sources|cache|grib)\//);
    expect(alignment).not.toMatch(/dataset\s*===\s*["']/);
    expect(alignment).not.toMatch(/PAIRS|pairs:/);
    // Heterogeneous result reading is isolated from orchestration.
    expect(alignment).toContain("./atmospheric-evidence.js");
    expect(evidence).not.toContain("UnifiedAtmosphereQueryService");
    expect(evidence).not.toMatch(/from ["']\.\.\/(?:access|sources|cache|grib)\//);
    // Compatibility is derived from the query contract, not re-declared.
    expect(schema).toContain("validateDatasetModifiers");
    expect(schema).not.toMatch(/dataset\s*===\s*["']/);
  });

  it("keeps dataset-specific capability validation out of the shared unified schema", async () => {
    const [schema, datasetValidation] = await Promise.all([
      readFile("src/schema/unified-api.ts", "utf8"),
      readFile("src/schema/dataset-capability-validation.ts", "utf8"),
    ]);

    expect(schema).toContain("./dataset-capability-validation.js");
    expect(schema).not.toMatch(
      /AIGFS_PRESSURE_|AIGEFS_MEMBERS|AIFS_PRESSURE_|AIFS_ENS_MEMBERS|HGEFS_MEMBERS|HGEFS_AREA_PRESSURE_|GEFS_REFORECAST_(?:EXTENDED_MEMBERS|FIELD_IDS|PRESSURE_VARIABLE_IDS)/,
    );
    expect(schema).not.toMatch(/request\.dataset\s*(?:===|!==)/);
    expect(schema).not.toMatch(/\bdataset\s*===\s*["']gefs["']/);
    expect(schema).not.toContain("datasetSupportsRunSelector");
    expect(datasetValidation).toContain("DATASET_CAPABILITY_VALIDATORS");
    expect(datasetValidation).toContain("validateGfsModifiers");
    expect(datasetValidation).toContain("validateGefsReforecastModifiers");
    expect(datasetValidation).not.toMatch(/from ["']\.\.\/(?:core|sources|access|cache|grib)\//);
  });

  it("keeps provider sources below schema, cache and meteorological physics", async () => {
    const files = await tsFiles("src/sources");
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(
        /from ["']\.\.\/(?:core|cli|schema|cache|derived)\//,
      );
      expect(source, path).not.toMatch(/from ["']node:(?:fs|path)(?:\/[^"']*)?["']/);
      expect(source, path).not.toContain("cacheDir");
      expect(source, path).not.toMatch(/from ["'][^"']*mcp[^"']*["']/);
    }
  });

  it("keeps provider credentials in the access layer", async () => {
    const [source, access] = await Promise.all([
      readFile("src/sources/pe-arome.ts", "utf8"),
      readFile("src/access/meteo-france-auth.ts", "utf8"),
    ]);

    expect(source).not.toContain("WFG_METEO_FRANCE_TOKEN");
    expect(access).toContain("WFG_METEO_FRANCE_TOKEN");
  });

  it("keeps transport identity centrally versioned", async () => {
    const files = [
      ...await tsFiles("src/sources"),
      ...await tsFiles("src/cache"),
    ];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(/weather-for-grown-ups\/\d+\.\d+/);
    }
  });

  it("keeps HTTP retry execution centralized in access", async () => {
    const files = [
      ...await tsFiles("src/sources"),
      ...await tsFiles("src/cache"),
    ];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(/waitBeforeHttpRetry/);
      expect(source, path).not.toMatch(/for\s*\([^)]*\battempt\b[^)]*\)/);
    }
  });

  it("keeps lower layers independent of core orchestration", async () => {
    const directories = [
      "src/access",
      "src/cache",
      "src/catalog",
      "src/derived",
      "src/grib",
      "src/schema",
      "src/sources",
    ];
    const files = (await Promise.all(directories.map(tsFiles))).flat();

    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(/from ["'](?:\.\.\/)+core\//);
    }
  });

  it("keeps ensemble run discovery out of full first-member execution", async () => {
    const files = [
      "src/core/aifs-ens.ts",
      "src/core/aigefs.ts",
      "src/core/icon-d2-eps.ts",
      "src/core/pe-arome.ts",
    ];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).toContain("ensemble-member-execution.js");
      expect(source, path).not.toContain("const firstResult = await firstService.query");
    }
  });

  it("requires ensemble run resolution before member payload execution", async () => {
    const source = await readFile("src/core/ensemble-member-execution.ts", "utf8");
    expect(source).toContain("resolveQueryRun(request: QueryAtmosphereRequest): Promise<Date>");
    expect(source).toContain("resolveDiagnosticRun(request: DiagnoseAtmosphereRequest): Promise<Date>");
    expect(source).not.toContain("resultRun(");
    expect(source).not.toContain("firstResult");
  });

  it("keeps independent deterministic forecast ranges bounded-concurrent", async () => {
    const files = [
      "src/core/aifs.ts",
      "src/core/aigfs.ts",
      "src/core/arome.ts",
      "src/core/icon-d2.ts",
      "src/core/ifs-spatiotemporal.ts",
      "src/core/time-series.ts",
    ];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(/for\s*\(const forecastHour of forecastHours\)\s*\{[\s\S]{0,160}?await/);
    }
  });

  it("keeps the public unified API module as a composition barrel", async () => {
    const api = await readFile("src/core/unified-atmosphere-api.ts", "utf8");
    expect(api).toContain("./unified-atmosphere-query.js");
    expect(api).toContain("./unified-atmosphere-diagnostics.js");
    expect(api).toContain("./unified-specialized-api.js");
    expect(api).not.toContain("query-adapters/");
    expect(api).not.toMatch(/Gefs|Ifs|Historical|ArchivedGfs/);
  });
});

async function tsFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `${directory}/${name}`);
}
