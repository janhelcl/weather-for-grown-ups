import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
} from "../src/access/access-policy.js";
import { NomadsCache } from "../src/cache/nomads-cache.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const gribResponse = (payload = "payload") =>
  new Response(new TextEncoder().encode(`GRIB${payload}`), { status: 200, statusText: "OK" });

let rootDir: string;
let cacheDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "wfg-cache-"));
  cacheDir = join(rootDir, "grib");
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

const makeCache = () => new NomadsCache(
  cacheDir,
  new FileAccessPolicy(join(rootDir, "state"), {
    ...UPSTREAM_ACCESS_POLICIES.nomads,
    minIntervalMs: 0,
  }),
);

describe("NomadsCache", () => {
  it("downloads GRIB once, stores it atomically, and serves subsequent cache hits", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => gribResponse());
    vi.stubGlobal("fetch", fetchMock);
    const cache = makeCache();
    const url = "https://example.test/gfs?field=TMP";

    const first = await cache.fetch(url);
    const second = await cache.fetch(url);

    expect(first.cacheHit).toBe(false);
    expect(second).toEqual({ path: first.path, cacheHit: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "user-agent": "weather-for-grown-ups/0.1" },
    });
    expect((await readFile(first.path)).subarray(0, 4).toString()).toBe("GRIB");
    expect((await readdir(cacheDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("deduplicates concurrent requests for the same URL", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      await delay(20);
      return gribResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    const cache = makeCache();
    const url = "https://example.test/same";

    const results = await Promise.all([cache.fetch(url), cache.fetch(url)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.cacheHit).sort()).toEqual([false, true]);
    expect(results[0]?.path).toBe(results[1]?.path);
  });

  it("uses different cache files for different request URLs", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => gribResponse());
    vi.stubGlobal("fetch", fetchMock);
    const cache = makeCache();

    const first = await cache.fetch("https://example.test/a");
    const second = await cache.fetch("https://example.test/b");

    expect(first.path).not.toBe(second.path);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects HTTP errors and does not poison the cache", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      new Response("down", { status: 503, statusText: "Service Unavailable" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cache = makeCache();

    await expect(cache.fetch("https://example.test/down")).rejects.toThrow(/HTTP 503 Service Unavailable/);
    expect((await readdir(cacheDir)).filter((name) => name.endsWith(".grib2"))).toEqual([]);
  });

  it("rejects non-GRIB content and includes a useful response preview", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      new Response("NOMADS maintenance page", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cache = makeCache();

    await expect(cache.fetch("https://example.test/html")).rejects.toThrow(/NOMADS maintenance page/);
    expect((await readdir(cacheDir)).filter((name) => name.endsWith(".grib2"))).toEqual([]);
  });

  it("rejects truncated content that cannot contain the GRIB signature", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response("GRI", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(makeCache().fetch("https://example.test/truncated")).rejects.toThrow(/non-GRIB/);
  });
});
