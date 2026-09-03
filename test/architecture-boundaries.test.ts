import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createAtmosphericDiagnosticAdapterRegistry } from "../src/core/diagnostic-adapters/registry.js";
import { createAtmosphericQueryAdapterRegistry } from "../src/core/query-adapters/registry.js";
import { createAtmosphericDatasetComparisonStrategyRegistry } from "../src/core/comparison-strategies/registry.js";
import {
  createAtmosphericAnalogAdapterRegistry,
  createAtmosphericRunComparisonAdapterRegistry,
  createAtmosphericVerificationAdapterRegistry,
} from "../src/core/specialized-adapters/registry.js";
import { PUBLIC_ATMOSPHERIC_DATASET_IDS } from "../src/schema/unified-api.js";
import { ATMOSPHERIC_DATASET_COMPARISON_PAIRS } from "../src/schema/unified-specialized.js";

describe("architecture boundaries", () => {
  it("keeps one query and diagnostic adapter registered for every public atmospheric dataset", () => {
    const expected = [...PUBLIC_ATMOSPHERIC_DATASET_IDS].sort();
    expect(Object.keys(createAtmosphericQueryAdapterRegistry()).sort()).toEqual(expected);
    expect(Object.keys(createAtmosphericDiagnosticAdapterRegistry()).sort()).toEqual(expected);
  });

  it("keeps specialized operation variants behind explicit adapter registries", () => {
    expect(Object.keys(createAtmosphericRunComparisonAdapterRegistry()).sort()).toEqual(
      ["gefs", "gfs", "ifs", "ifs-ens"],
    );
    expect(Object.keys(createAtmosphericDatasetComparisonStrategyRegistry()).sort()).toEqual(
      ATMOSPHERIC_DATASET_COMPARISON_PAIRS
        .map(([left, right]) => `${left}:${right}`)
        .sort(),
    );
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
        expect(surface).toContain("compareAtmosphericRunsSchema.parse");
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
    expect(service).toContain("comparison-strategies/registry.js");
    expect(service).toContain("adapters?: Partial<AtmosphericRunComparisonAdapterRegistry>");
    expect(service).toContain("strategies?: Partial<AtmosphericDatasetComparisonStrategyRegistry>");
    expect(service).not.toMatch(
      /from ["']\.\/(?:gfs|gefs|ifs|history|igra|run-comparison)[^"']*\.js/,
    );
    expect(service).not.toMatch(/request\.(?:dataset|referenceDataset)\s*===/);
  });

  it("keeps operation adapters above transport and decoding details", async () => {
    const files = [
      ...await tsFiles("src/core/query-adapters"),
      ...await tsFiles("src/core/diagnostic-adapters"),
      ...await tsFiles("src/core/specialized-adapters"),
      ...await tsFiles("src/core/comparison-strategies"),
    ];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(
        /from ["']\.\.\/\.\.\/(?:access|sources|cache|grib|derived)\//,
      );
    }
  });

  it("keeps comparison strategy responsibilities separated", async () => {
    const [barrel, pairNative, modelClass] = await Promise.all([
      readFile("src/core/comparison-strategies/strategies.ts", "utf8"),
      readFile("src/core/comparison-strategies/pair-native-strategies.ts", "utf8"),
      readFile("src/core/comparison-strategies/model-class-strategies.ts", "utf8"),
    ]);

    expect(barrel).not.toContain("class ");
    expect(pairNative).not.toContain("ModelClassComparisonService");
    expect(modelClass).toContain("ModelClassComparisonService");
    expect(modelClass).not.toMatch(
      /GfsGefsComparisonService|GfsIfsComparisonService|GefsIfsEnsComparisonService|IfsIfsEnsComparisonService/,
    );
  });

  it("isolates heterogeneous comparison-result reading from query orchestration", async () => {
    const [service, reader] = await Promise.all([
      readFile("src/core/model-class-comparison.ts", "utf8"),
      readFile("src/core/comparison-result-reader.ts", "utf8"),
    ]);

    expect(service).toContain("./comparison-result-reader.js");
    expect(service).not.toContain("Record<string, any>");
    expect(reader).not.toContain("UnifiedAtmosphereQueryService");
    expect(reader).not.toMatch(/from ["']\.\.\/(?:access|sources|cache|grib)\//);
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
      expect(source, path).not.toMatch(/from ["'][^"']*mcp[^"']*["']/);
    }
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
