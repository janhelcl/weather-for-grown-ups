import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
} from "../src/access/access-policy.js";
import { WFG_USER_AGENT } from "../src/access/user-agent.js";
import { NomadsAreaCache, NomadsCache } from "../src/cache/nomads-cache.js";
import { expandRequestedVariables } from "../src/catalog/variables.js";
import { NomadsSource } from "../src/sources/nomads.js";
import type { ProfileDataRequest } from "../src/sources/types.js";

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

function request(longitude = 14.43): ProfileDataRequest {
  return {
    run: new Date("2026-08-19T06:00:00Z"),
    forecastHour: 6,
    latitude: 50.08,
    longitude,
    variables: expandRequestedVariables(["temperature"]),
    pressureLevelsHpa: [850],
  };
}

function source(): NomadsSource {
  return new NomadsSource(
    new FileAccessPolicy(join(rootDir, "state"), {
      ...UPSTREAM_ACCESS_POLICIES.nomads,
      minIntervalMs: 0,
    }),
    globalThis.fetch,
    { baseDelayMs: 0, jitterRatio: 0 },
  );
}

const makeCache = () => new NomadsCache(cacheDir, source());

describe("NomadsCache", () => {
  it("downloads through the source once, stores atomically, and serves subsequent cache hits", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => gribResponse());
    vi.stubGlobal("fetch", fetchMock);
    const cache = makeCache();

    const first = await cache.fetch(request());
    const second = await cache.fetch(request());

    expect(first.cacheHit).toBe(false);
    expect(second).toEqual({ path: first.path, cacheHit: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "user-agent": WFG_USER_AGENT },
    });
    expect((await readFile(first.path)).subarray(0, 4).toString()).toBe("GRIB");
    expect((await readdir(cacheDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("materializes area requests through the same provider source without leaking URL construction into core", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => gribResponse("area"));
    vi.stubGlobal("fetch", fetchMock);
    const cache = new NomadsAreaCache(cacheDir, source());

    const first = await cache.fetch({
      run: new Date("2026-08-19T06:00:00Z"),
      grid: "0p50",
      forecastHour: 6,
      westLongitude: 12,
      eastLongitude: 18,
      southLatitude: 48,
      northLatitude: 51,
      variables: expandRequestedVariables(["temperature"]),
      pressureLevelsHpa: [850],
    });
    const second = await cache.fetch({
      run: new Date("2026-08-19T06:00:00Z"),
      grid: "0p50",
      forecastHour: 6,
      westLongitude: 12,
      eastLongitude: 18,
      southLatitude: 48,
      northLatitude: 51,
      variables: expandRequestedVariables(["temperature"]),
      pressureLevelsHpa: [850],
    });

    expect(second).toEqual({ path: first.path, cacheHit: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/cgi-bin/filter_gfs_0p50.pl");
    expect(url.searchParams.get("file")).toBe("gfs.t06z.pgrb2full.0p50.f006");
    expect(url.searchParams.get("var_TMP")).toBe("on");
    expect(url.searchParams.get("lev_850_mb")).toBe("on");
  });

  it("deduplicates concurrent requests for the same canonical profile request", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      await delay(20);
      return gribResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    const cache = makeCache();

    const results = await Promise.all([cache.fetch(request()), cache.fetch(request())]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.cacheHit).sort()).toEqual([false, true]);
    expect(results[0]?.path).toBe(results[1]?.path);
  });

  it("uses different cache files for different canonical profile requests", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => gribResponse());
    vi.stubGlobal("fetch", fetchMock);
    const cache = makeCache();

    const first = await cache.fetch(request(14.43));
    const second = await cache.fetch(request(15.43));

    expect(first.path).not.toBe(second.path);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient HTTP failures in the provider source", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      attempt += 1;
      return attempt === 1
        ? new Response("busy", { status: 503, statusText: "Service Unavailable" })
        : gribResponse("recovered");
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await makeCache().fetch(request());

    expect(result.cacheHit).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects HTTP errors and does not poison the cache", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      new Response("down", { status: 503, statusText: "Service Unavailable" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cache = makeCache();

    await expect(cache.fetch(request())).rejects.toThrow(/HTTP 503 Service Unavailable/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((await readdir(cacheDir)).filter((name) => name.endsWith(".grib2"))).toEqual([]);
  });

  it("rejects non-GRIB content without exposing the upstream response body", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      new Response("NOMADS maintenance page", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cache = makeCache();

    await expect(cache.fetch(request())).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      message: "NOAA NOMADS returned invalid non-GRIB content",
      retryable: true,
      details: { provider: "NOAA NOMADS" },
    });
    expect((await readdir(cacheDir)).filter((name) => name.endsWith(".grib2"))).toEqual([]);
  });

  it("rejects truncated content that cannot contain the GRIB signature", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response("GRI", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(makeCache().fetch(request())).rejects.toThrow(/non-GRIB/);
  });
});
