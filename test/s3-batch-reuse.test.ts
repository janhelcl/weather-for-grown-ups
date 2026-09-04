import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GfsS3SubsetCache } from "../src/cache/s3-subset-cache.js";
import { expandRequestedVariables } from "../src/catalog/variables.js";
import { GfsS3Source } from "../src/sources/gfs-s3.js";
import type { ProfileDataRequest } from "../src/sources/types.js";

let rootDir: string;

beforeEach(async () => { rootDir = await mkdtemp(join(tmpdir(), "wfg-s3-batch-")); });
afterEach(async () => { await rm(rootDir, { recursive: true, force: true }); });

function request(latitude: number, longitude: number): ProfileDataRequest {
  return {
    run: new Date("2026-08-19T06:00:00Z"),
    forecastHour: 6,
    latitude,
    longitude,
    variables: expandRequestedVariables(["temperature"]),
    pressureLevelsHpa: [850],
  };
}

describe("S3 subset reuse for multi-point sampling", () => {
  it("uses one selected-message GRIB slice regardless of requested coordinates", async () => {
    const index = "1:0:d=2026081906:TMP:850 mb:6 hour fcst:";
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith(".idx")) return new Response(index, { status: 200 });
      expect(new Headers(init?.headers).get("range")).toBe("bytes=0-");
      return new Response(new TextEncoder().encode("GRIB0000"), { status: 206 });
    });
    const cache = new GfsS3SubsetCache(
      rootDir,
      new GfsS3Source(undefined, fetchFn as typeof fetch, undefined, { baseDelayMs: 0, jitterRatio: 0 }),
    );

    const [prague, bassano, meduno] = await Promise.all([
      cache.fetch(request(50.08, 14.43)),
      cache.fetch(request(45.8, 11.7)),
      cache.fetch(request(46.24, 13.18)),
    ]);

    expect(prague.path).toBe(bassano.path);
    expect(bassano.path).toBe(meduno.path);
    expect([prague.cacheHit, bassano.cacheHit, meduno.cacheHit].filter((value) => !value)).toHaveLength(1);
    expect(fetchFn.mock.calls.filter(([input]) => String(input).endsWith(".idx"))).toHaveLength(1);
    expect(fetchFn.mock.calls.filter(([, init]) => new Headers(init?.headers).has("range"))).toHaveLength(1);
  });
});
