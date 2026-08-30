import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createAtmosphericQueryAdapterRegistry } from "../src/core/query-adapters/registry.js";
import { PUBLIC_ATMOSPHERIC_DATASET_IDS } from "../src/schema/unified-api.js";

describe("architecture boundaries", () => {
  it("keeps one query adapter registered for every public atmospheric dataset", () => {
    const registry = createAtmosphericQueryAdapterRegistry();
    expect(Object.keys(registry).sort()).toEqual([...PUBLIC_ATMOSPHERIC_DATASET_IDS].sort());
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

  it("keeps dataset adapters above transport and decoding details", async () => {
    const files = await tsFiles("src/core/query-adapters");
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
