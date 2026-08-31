import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpstreamAccessPolicy } from "../src/access/access-policy.js";
import { AifsEnsOpenDataSubsetCache } from "../src/cache/aifs-ens-open-data-cache.js";

const run = new Date("2026-08-31T00:00:00Z");
const immediatePolicy: UpstreamAccessPolicy = {
  run: <T>(operation: () => Promise<T>) => operation(),
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("AIFS ENS Open Data subset cache", () => {
  it("filters the shared perturbed index by member number and caches selected ranges", async () => {
    const root = await tempRoot();
    const index = [
      '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","number":"1","_offset":100,"_length":4}',
      '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","number":"2","_offset":200,"_length":4}',
      '{"date":"20260831","time":"0000","step":"6","levtype":"sfc","param":"2t","number":"1","_offset":300,"_length":4}',
    ].join("\n");
    let indexCalls = 0;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith(".index")) {
        indexCalls += 1;
        return new Response(index, { status: 200 });
      }
      const range = new Headers(init?.headers).get("range");
      expect(range === "bytes=100-103" || range === "bytes=300-303").toBe(true);
      return new Response(bytes("GRIB"), { status: 206 });
    }) as typeof fetch;

    const cache = new AifsEnsOpenDataSubsetCache(
      root,
      "p01",
      fetchFn,
      1,
      immediatePolicy,
      immediatePolicy,
    );
    const request = {
      run,
      forecastHour: 6,
      selectors: [
        { key: "temperature@850", param: "t", levtype: "pl" as const, levelist: 850 },
        { key: "temperature_2m", param: "2t", levtype: "sfc" as const },
      ],
    };

    const first = await cache.fetchSelection(request);
    expect(first.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(first.path))).toBe("GRIBGRIB");
    expect(fetchFn).toHaveBeenCalledTimes(3);

    const second = await cache.fetchSelection(request);
    expect(second).toEqual({ path: first.path, cacheHit: true });
    expect(indexCalls).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("reads the dedicated control index without inventing a member number", async () => {
    const root = await tempRoot();
    const index =
      '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","_offset":0,"_length":4}';
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(".index")) {
        expect(url).toContain("-enfo-cf.index");
        return new Response(index, { status: 200 });
      }
      expect(url).toContain("-enfo-cf.grib2");
      expect(new Headers(init?.headers).get("range")).toBe("bytes=0-3");
      return new Response(bytes("GRIB"), { status: 206 });
    }) as typeof fetch;

    const cache = new AifsEnsOpenDataSubsetCache(
      root,
      "c00",
      fetchFn,
      1,
      immediatePolicy,
      immediatePolicy,
    );
    const result = await cache.fetchSelection({
      run,
      forecastHour: 6,
      selectors: [
        { key: "temperature@850", param: "t", levtype: "pl", levelist: 850 },
      ],
    });

    expect(result.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(result.path))).toBe("GRIB");
  });

  it("coalesces concurrent identical subset downloads", async () => {
    const root = await tempRoot();
    let releaseRange!: () => void;
    const rangeGate = new Promise<void>((resolve) => { releaseRange = resolve; });
    let rangeCalls = 0;
    const index =
      '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","number":"1","_offset":0,"_length":4}';
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith(".index")) {
        return new Response(index, { status: 200 });
      }
      rangeCalls += 1;
      await rangeGate;
      return new Response(bytes("GRIB"), { status: 206 });
    }) as typeof fetch;
    const cache = new AifsEnsOpenDataSubsetCache(
      root,
      "p01",
      fetchFn,
      1,
      immediatePolicy,
      immediatePolicy,
    );
    const request = {
      run,
      forecastHour: 6,
      selectors: [
        { key: "temperature@850", param: "t", levtype: "pl" as const, levelist: 850 },
      ],
    };

    const first = cache.fetchSelection(request);
    const second = cache.fetchSelection(request);
    releaseRange();
    const [a, b] = await Promise.all([first, second]);

    expect(a.path).toBe(b.path);
    expect([a.cacheHit, b.cacheHit].sort()).toEqual([false, true]);
    expect(rangeCalls).toBe(1);
  });

  it("uses the indexed member selection for latest-run availability probes", async () => {
    const root = await tempRoot();
    let missing = false;
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain("-enfo-pf.index");
      if (missing) {
        return new Response(
          '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","number":"2","_offset":0,"_length":4}',
          { status: 200 },
        );
      }
      return new Response(
        '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","number":"1","_offset":0,"_length":4}',
        { status: 200 },
      );
    }) as typeof fetch;
    const cache = new AifsEnsOpenDataSubsetCache(
      root,
      "p01",
      fetchFn,
      1,
      immediatePolicy,
      immediatePolicy,
    );
    const selectors = [
      { key: "temperature@850", param: "t", levtype: "pl" as const, levelist: 850 },
    ];

    await expect(cache.isForecastAvailable(run, 6, selectors)).resolves.toBe(true);
    missing = true;
    await expect(cache.isForecastAvailable(run, 6, selectors)).resolves.toBe(false);
  });

  it("rejects empty selections, malformed ranges and failed mirrors explicitly", async () => {
    const root = await tempRoot();
    const index =
      '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","number":"1","_offset":0,"_length":4}';
    let mode: "bad-body" | "bad-http" = "bad-body";
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (mode === "bad-http") {
        return new Response("bad", { status: 400, statusText: "Bad Request" });
      }
      if (String(input).endsWith(".index")) {
        return new Response(index, { status: 200 });
      }
      return new Response(bytes("NOPE"), { status: 206 });
    }) as typeof fetch;

    const cache = new AifsEnsOpenDataSubsetCache(
      root,
      "p01",
      fetchFn,
      1,
      immediatePolicy,
      immediatePolicy,
    );

    await expect(cache.fetchSelection({
      run,
      forecastHour: 6,
      selectors: [],
    })).rejects.toThrow("selected no fields");

    await expect(cache.fetchSelection({
      run,
      forecastHour: 6,
      selectors: [
        { key: "temperature@850", param: "t", levtype: "pl", levelist: 850 },
      ],
    })).rejects.toThrow("failed across all configured mirrors");

    mode = "bad-http";
    await expect(cache.isForecastAvailable(run, 6, [
      { key: "temperature@850", param: "t", levtype: "pl", levelist: 850 },
    ])).rejects.toThrow("run discovery failed");
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wfg-aifs-ens-cache-"));
  roots.push(root);
  return root;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
