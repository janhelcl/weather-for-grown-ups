import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GfsS3SubsetCache } from "../src/cache/s3-subset-cache.js";
import { expandRequestedVariables } from "../src/catalog/variables.js";
import type { ProfileDataRequest } from "../src/sources/types.js";

const indexText = [
  "1:0:d=2026081906:TMP:850 mb:6 hour fcst:",
  "2:8:d=2026081906:RH:850 mb:6 hour fcst:",
  "3:16:d=2026081906:UGRD:850 mb:6 hour fcst:",
  "4:24:d=2026081906:VGRD:850 mb:6 hour fcst:",
  "5:32:d=2026081906:TMP:700 mb:6 hour fcst:",
  "6:40:d=2026081906:RH:700 mb:6 hour fcst:",
  "7:48:d=2026081906:HGT:surface:6 hour fcst:",
].join("\n");

const chunks: Record<string, string> = {
  "bytes=0-7": "GRIB0000", "bytes=8-15": "GRIB1111", "bytes=16-23": "GRIB2222",
  "bytes=24-31": "GRIB3333", "bytes=32-39": "GRIB4444", "bytes=40-47": "GRIB5555",
};

let rootDir: string;

beforeEach(async () => { rootDir = await mkdtemp(join(tmpdir(), "wfg-s3-")); });
afterEach(async () => { await rm(rootDir, { recursive: true, force: true }); });

function request(variables = ["temperature", "relative_humidity"] as const, levels = [850]): ProfileDataRequest {
  return {
    run: new Date("2026-08-19T06:00:00Z"), forecastHour: 6, latitude: 50.08, longitude: 14.43,
    variables: expandRequestedVariables([...variables]), pressureLevelsHpa: levels,
  };
}

function makeFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith(".idx")) return new Response(indexText, { status: 200 });
    const range = new Headers(init?.headers).get("range");
    const body = range === null ? undefined : chunks[range];
    if (!body) return new Response("missing", { status: 416, statusText: "Range Not Satisfiable" });
    return new Response(new TextEncoder().encode(body), { status: 206 });
  });
}

describe("GfsS3SubsetCache", () => {
  it("fetches the index, downloads only selected GRIB byte ranges, and concatenates messages", async () => {
    const fetchFn = makeFetch();
    const cache = new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch);
    const result = await cache.fetch(request());
    expect(result.cacheHit).toBe(false);
    expect(Buffer.from(await readFile(result.path)).toString()).toBe("GRIB0000GRIB1111");
    expect(fetchFn.mock.calls.filter(([input]) => String(input).endsWith(".idx"))).toHaveLength(1);
    expect(fetchFn.mock.calls
      .map(([, init]) => new Headers(init?.headers).get("range"))
      .filter((range): range is string => range !== null)
      .sort()).toEqual([
        "bytes=0-7", "bytes=8-15",
      ]);
  });

  it("returns a disk cache hit without any upstream requests", async () => {
    const fetchFn = makeFetch();
    const cache = new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch);
    const first = await cache.fetch(request());
    const callCount = fetchFn.mock.calls.length;
    expect(await cache.fetch(request())).toEqual({ path: first.path, cacheHit: true });
    expect(fetchFn).toHaveBeenCalledTimes(callCount);
  });

  it("canonicalizes variable and level ordering in the subset cache key", async () => {
    const fetchFn = makeFetch();
    const cache = new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch);
    const first = await cache.fetch(request(["temperature", "relative_humidity"], [850, 700]));
    const callCount = fetchFn.mock.calls.length;
    const second = await cache.fetch(request(["relative_humidity", "temperature"], [700, 850, 850]));
    expect(second.path).toBe(first.path);
    expect(second.cacheHit).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(callCount);
  });

  it("reuses the immutable index file across different subsets of the same forecast file", async () => {
    const fetchFn = makeFetch();
    const cache = new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch);
    await cache.fetch(request(["temperature"], [850]));
    await cache.fetch(request(["relative_humidity"], [850]));
    expect(fetchFn.mock.calls.filter(([input]) => String(input).endsWith(".idx"))).toHaveLength(1);
  });

  it("deduplicates concurrent identical subset downloads in-process", async () => {
    const fetchFn = makeFetch();
    const cache = new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch);
    const [first, second] = await Promise.all([cache.fetch(request()), cache.fetch(request())]);
    expect(first.path).toBe(second.path);
    expect([first.cacheHit, second.cacheHit].sort()).toEqual([false, true]);
    expect(fetchFn.mock.calls.filter(([, init]) => new Headers(init?.headers).has("range"))).toHaveLength(2);
  });

  it("writes safely when separate cache instances download the same subset concurrently", async () => {
    const fetchFn = makeFetch();
    const firstCache = new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch);
    const secondCache = new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch);

    const [first, second] = await Promise.all([
      firstCache.fetch(request()),
      secondCache.fetch(request()),
    ]);

    expect(first.path).toBe(second.path);
    expect(Buffer.from(await readFile(first.path)).toString()).toBe("GRIB0000GRIB1111");
  });

  it("bounds concurrent range requests", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith(".idx")) return new Response(indexText, { status: 200 });
      const range = new Headers(init?.headers).get("range");
      const body = range === null ? undefined : chunks[range];
      if (!body) return new Response("missing", { status: 416 });
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return new Response(new TextEncoder().encode(body), { status: 206 });
    });
    const cache = new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch, 2);

    await cache.fetch(request(["temperature", "relative_humidity"], [850, 700]));

    expect(maxActive).toBe(2);
  });

  it("fails on an unavailable index", async () => {
    const fetchFn = vi.fn(async () => new Response("no", {
      status: 503,
      statusText: "Unavailable",
      headers: { "retry-after": "0" },
    }));
    await expect(new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch).fetch(request()))
      .rejects.toThrow(/index request failed: HTTP 503/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("fails rather than accepting a server that ignores the Range header", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith(".idx") ? new Response(indexText, { status: 200 }) : new Response(new TextEncoder().encode("GRIB0000"), { status: 200 }));
    await expect(new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch).fetch(request(["temperature"], [850]))).rejects.toThrow(/range request failed: HTTP 200/);
  });

  it("rejects byte ranges that do not begin with a GRIB message", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith(".idx") ? new Response(indexText, { status: 200 }) : new Response(new TextEncoder().encode("NOPE0000"), { status: 206 }));
    await expect(new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch).fetch(request(["temperature"], [850]))).rejects.toThrow(/did not start with a GRIB message/);
  });

  it("fails before range downloads when the index lacks any requested variable-level combination", async () => {
    const fetchFn = makeFetch();
    const cache = new GfsS3SubsetCache(rootDir, fetchFn as typeof fetch);
    await expect(cache.fetch(request(["temperature"], [925]))).rejects.toThrow(/TMP@925mb/);
    expect(fetchFn.mock.calls.filter(([, init]) => new Headers(init?.headers).has("range"))).toHaveLength(0);
  });
});
