import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("canonical architectural ownership", () => {
  it("does not re-export decoder contracts through core", async () => {
    const coreTypes = await readFile("src/core/types.ts", "utf8");
    expect(coreTypes).not.toMatch(/export\s+type\s*\{[^}]*\}\s+from\s+["']\.\.\/types\/decoded\.js["']/s);
  });

  it("does not re-export GEFS cadence contracts through core", async () => {
    const gefsTime = await readFile("src/core/gefs-time.ts", "utf8");
    expect(gefsTime).not.toMatch(/export\s*\{[^}]*GEFS_(?:MAX_FORECAST_HOUR|FORECAST_STEP_HOURS|TOTAL_NATIVE_FORECAST_STEPS)[^}]*\}\s+from\s+["']\.\.\/catalog\/gefs\.js["']/s);
  });
});
