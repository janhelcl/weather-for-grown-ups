import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CachedNceiGfsHistorySource } from "../src/cache/historical-gfs-cache.js";
import { CachedNceiIgraSource } from "../src/cache/igra-cache.js";
import { NceiGfsHistorySource } from "../src/sources/ncei-gfs-history.js";
import { NceiIgraSource } from "../src/sources/ncei-igra.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("provider transport retries", () => {
  it("retries transient NCEI THREDDS failures through the access policy", async () => {
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("busy", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "retry-after": "0" },
      }))
      .mockResolvedValueOnce(new Response("a,b\n1,2", { status: 200 }));
    const source = new NceiGfsHistorySource({
      limiter: { run },
      fetchFn,
      retryBaseDelayMs: 0,
      retryJitterRatio: 0,
    });

    const result = await source.fetch({
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      latitude: 50,
      longitude: 14,
      variables: ["Temperature_isobaric"],
    });

    expect(result.cacheHit).toBe(false);
    expect(result.csv).toBe("a,b\n1,2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("classifies exhausted NCEI 5xx responses as upstream unavailability", async () => {
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const fetchFn = vi.fn(async () =>
      new Response("busy", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "retry-after": "0" },
      })
    );
    const source = new NceiGfsHistorySource({
      limiter: { run },
      fetchFn,
      retryBaseDelayMs: 0,
      retryJitterRatio: 0,
    });

    await expect(source.fetch({
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      latitude: 50,
      longitude: 14,
      variables: ["Temperature_isobaric"],
    })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
      details: { provider: "NOAA NCEI", status: 503 },
    });
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
  });

  it("deduplicates concurrent identical NCEI cache misses above the source boundary", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "wfg-ncei-concurrent-"));
    roots.push(cacheDir);
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchFn = vi.fn(async () => {
      markStarted();
      await gate;
      return new Response("a,b\n1,2", { status: 200 });
    });
    const source = new CachedNceiGfsHistorySource(
      cacheDir,
      new NceiGfsHistorySource({
        limiter: { run },
        fetchFn,
        retryBaseDelayMs: 0,
        retryJitterRatio: 0,
      }),
    );
    const request = {
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      latitude: 50,
      longitude: 14,
      variables: ["Temperature_isobaric"] as const,
    };

    const firstPromise = source.fetch(request);
    await started;
    const secondPromise = source.fetch(request);
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    const cached = await source.fetch(request);

    expect(first.csv).toBe("a,b\n1,2");
    expect(second.csv).toBe("a,b\n1,2");
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(cached.cacheHit).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("does not retry terminal NCEI 404 responses", async () => {
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const fetchFn = vi.fn(async () =>
      new Response("", { status: 404, statusText: "Not Found" })
    );
    const source = new NceiGfsHistorySource({
      limiter: { run },
      fetchFn,
      retryBaseDelayMs: 0,
      retryJitterRatio: 0,
    });

    await expect(source.fetch({
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      latitude: 50,
      longitude: 14,
      variables: ["Temperature_isobaric"],
    })).rejects.toMatchObject({
      code: "DATA_UNAVAILABLE",
      retryable: false,
      details: {
        provider: "NOAA NCEI",
        analysisTime: "2017-05-09T00:00:00.000Z",
      },
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("retries throttled IGRA downloads and then reuses the cached station list", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "wfg-igra-retry-"));
    roots.push(cacheDir);
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const stationList = stationLine({
      id: "EZM00011520",
      latitude: "50.0078",
      longitude: "14.4469",
      elevation: "302.0",
      name: "PRAHA-LIBUS",
      firstYear: "1969",
      lastYear: "2026",
      observations: "70000",
    });
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("slow down", {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "0" },
      }))
      .mockResolvedValueOnce(new Response(stationList, { status: 200 }));
    const now = () => new Date("2026-08-28T12:00:00Z");
    const source = new CachedNceiIgraSource(
      cacheDir,
      new NceiIgraSource({
        limiter: { run },
        fetchFn,
        retryBaseDelayMs: 0,
        retryJitterRatio: 0,
        now,
      }),
      now,
    );

    const first = await source.listStations();
    const second = await source.listStations();

    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe("EZM00011520");
    expect(second).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

function stationLine(input: {
  id: string;
  latitude: string;
  longitude: string;
  elevation: string;
  name: string;
  firstYear: string;
  lastYear: string;
  observations: string;
}): string {
  const chars = Array(88).fill(" ");
  put(chars, 1, 11, input.id, false);
  put(chars, 13, 20, input.latitude, true);
  put(chars, 22, 30, input.longitude, true);
  put(chars, 32, 37, input.elevation, true);
  put(chars, 42, 71, input.name, false);
  put(chars, 73, 76, input.firstYear, true);
  put(chars, 78, 81, input.lastYear, true);
  put(chars, 83, 88, input.observations, true);
  return chars.join("");
}

function put(
  chars: string[],
  start: number,
  end: number,
  value: string,
  rightAlign: boolean,
): void {
  const width = end - start + 1;
  const fitted = rightAlign ? value.padStart(width) : value.padEnd(width);
  for (let index = 0; index < width; index += 1) {
    chars[start - 1 + index] = fitted[index] ?? " ";
  }
}
