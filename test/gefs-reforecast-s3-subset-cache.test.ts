import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GefsReforecastS3SubsetCache } from "../src/cache/gefs-reforecast-s3-subset-cache.js";
import { VARIABLE_CATALOG } from "../src/catalog/variables.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GEFSv12 reforecast archive inventory", () => {
  it("reports a supported-but-missing pressure level as run-local availability", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-gefs-reforecast-inventory-"));
    roots.push(root);
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const index = [
      "1:0:d=2017031400:SPFH:850 mb:12 hour fcst:",
      "2:100:d=2017031400:SPFH:500 mb:12 hour fcst:",
      "",
    ].join("\n");
    const fetchFn = vi.fn(async () => new Response(index, { status: 200 }));
    const cache = new GefsReforecastS3SubsetCache(
      root,
      fetchFn,
      { run },
    );

    await expect(cache.fetchSelection({
      run: new Date("2017-03-14T00:00:00Z"),
      forecastHour: 12,
      member: "c00",
      pressureVariables: [VARIABLE_CATALOG.specific_humidity],
      pressureLevelsHpa: [700],
    })).rejects.toThrow(
      /specific_humidity@700mb.*available SPFH levels in this file: 850, 500.*run-local archive availability/i,
    );

    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
