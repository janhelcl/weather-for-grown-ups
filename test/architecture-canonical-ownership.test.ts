import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("canonical architectural ownership", () => {
  it("does not re-export decoder contracts through core", async () => {
    const coreTypes = await readFile("src/core/types.ts", "utf8");
    expect(coreTypes).not.toMatch(
      /export\s+type\s*\{[^}]*\}\s+from\s+["']\.\.\/types\/decoded\.js["']/s,
    );
  });

  it("does not route decoder contracts through core/types", async () => {
    const files = [
      ...await tsFiles("src/core"),
      ...await tsFiles("test"),
    ];

    for (const path of files) {
      if (path === "src/core/types.ts") continue;
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(
        /import(?:\s+type)?\s*\{[^;{}]*(?:DecodedValue|ForecastInterval|GribDecoderName|GridPoint)[^;{}]*\}\s*from\s*["'](?:\.\/types|\.\.\/src\/core\/types)\.js["']/s,
      );
    }
  });

  it("does not re-export GEFS cadence contracts through core", async () => {
    const gefsTime = await readFile("src/core/gefs-time.ts", "utf8");
    expect(gefsTime).not.toMatch(
      /export\s*\{[^}]*GEFS_(?:MAX_FORECAST_HOUR|FORECAST_STEP_HOURS|TOTAL_NATIVE_FORECAST_STEPS)[^}]*\}\s+from\s+["']\.\.\/catalog\/gefs\.js["']/s,
    );
  });

  it("does not route GEFS cadence contracts through core/gefs-time", async () => {
    const files = await tsFiles("src/core");
    for (const path of files) {
      if (path === "src/core/gefs-time.ts") continue;
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(
        /import\s*\{[^;{}]*GEFS_(?:MAX_FORECAST_HOUR|FORECAST_STEP_HOURS|TOTAL_NATIVE_FORECAST_STEPS)[^;{}]*\}\s*from\s*["']\.\/gefs-time\.js["']/s,
      );
    }
  });
});

async function tsFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `${directory}/${name}`);
}
