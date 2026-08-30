import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createAtmosphericDiagnosticAdapterRegistry } from "../src/core/diagnostic-adapters/registry.js";
import { createAtmosphericQueryAdapterRegistry } from "../src/core/query-adapters/registry.js";
import {
  createAtmosphericAnalogAdapterRegistry,
  createAtmosphericDatasetComparisonAdapterRegistry,
  createAtmosphericRunComparisonAdapterRegistry,
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
    expect(Object.keys(createAtmosphericRunComparisonAdapterRegistry()).sort()).toEqual(
      ["gefs", "gfs", "ifs", "ifs-ens"],
    );
    expect(Object.keys(createAtmosphericDatasetComparisonAdapterRegistry()).sort()).toEqual(
      ["gefs:ifs-ens", "gfs:gefs", "gfs:ifs", "ifs:ifs-ens"],
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
      expect(surface).not.toMatch(
        /core\/(?:gfs|gefs|ifs|history|archived-gfs)-(?!unified)[^"']+\.js/,
      );
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
    expect(service).toContain("adapters?: Partial<AtmosphericRunComparisonAdapterRegistry>");
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
    ];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(
        /from ["']\.\.\/\.\.\/(?:access|sources|cache|grib|derived)\//,
      );
    }
  });

  it("keeps provider sources independent of application core", async () => {
    const files = await tsFiles("src/sources");
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(/from ["']\.\.\/(?:core|cli)\//);
      expect(source, path).not.toMatch(/from ["'][^"']*mcp[^"']*["']/);
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

  it("keeps the public unified API module as a composition barrel", async () => {
    const api = await readFile("src/core/unified-atmosphere-api.ts", "utf8");
    expect(api).toContain("./unified-atmosphere-query.js");
    expect(api).toContain("./unified-atmosphere-diagnostics.js");
    expect(api).not.toContain("query-adapters/");
    expect(api).not.toMatch(/Gefs|Ifs|Historical|ArchivedGfs/);
  });
});

async function tsFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `${directory}/${name}`);
}
