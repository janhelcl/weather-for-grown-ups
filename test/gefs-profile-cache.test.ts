import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GefsS3SubsetCache } from "../src/cache/gefs-s3-subset-cache.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GEFS multi-field subset cache", () => {
  it("downloads one selected-message slice and canonicalizes equivalent selections", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-gefs-profile-"));
    roots.push(root);
    const index = [
      "1:0:d=2026082312:TMP:850 mb:6 hour fcst:",
      "2:100:d=2026082312:HGT:850 mb:6 hour fcst:",
      "3:200:d=2026082312:TMP:500 mb:6 hour fcst:",
      "4:300:d=2026082312:HGT:500 mb:6 hour fcst:",
      "5:400:d=2026082312:RH:500 mb:6 hour fcst:",
    ].join("\n");
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(".idx")) return new Response(index, { status: 200 });
      expect(init?.headers).toEqual(expect.objectContaining({ range: expect.stringMatching(/^bytes=/) }));
      return new Response(new TextEncoder().encode("GRIB"), { status: 206 });
    }) as typeof fetch;
    const cache = new GefsS3SubsetCache(root, fetchFn);
    const request = {
      run: new Date("2026-08-23T12:00:00Z"),
      forecastHour: 6,
      member: "c00" as const,
      variableCodes: ["TMP", "HGT"] as ("TMP" | "HGT")[],
      pressureLevelsHpa: [850, 500],
    };

    const first = await cache.fetchSelection(request);
    const second = await cache.fetchSelection({
      ...request,
      variableCodes: ["HGT", "TMP"],
      pressureLevelsHpa: [500, 850],
    });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.path).toBe(first.path);
    expect(fetchFn).toHaveBeenCalledTimes(5); // one index plus four selected GRIB byte ranges
    expect(fetchFn.mock.calls.filter(([, init]) => (init?.headers as Record<string, string> | undefined)?.range)).toHaveLength(4);
  });
});
