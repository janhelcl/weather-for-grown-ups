import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AifsOpenDataSubsetCache } from "../src/cache/aifs-open-data-cache.js";
import type { UpstreamAccessPolicy } from "../src/access/access-policy.js";

const run = new Date("2026-08-31T00:00:00Z");
const immediatePolicy: UpstreamAccessPolicy = {
  run: <T>(operation: () => Promise<T>) => operation(),
};

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AIFS Open Data subset cache", () => {
  it("downloads selected ranges, reuses the immutable index and returns subset cache hits", async () => {
    const root = await tempRoot();
    let indexCalls = 0;
    let rangeCalls = 0;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(".index")) {
        indexCalls += 1;
        return new Response([
          '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","_offset":0,"_length":8}',
          '{"date":"20260831","time":"0000","step":"6","levtype":"sfc","param":"2t","_offset":8,"_length":8}',
        ].join("\n"), { status: 200 });
      }
      rangeCalls += 1;
      const range = new Headers(init?.headers).get("range");
      if (range === "bytes=0-7") return new Response(bytes("GRIBtemp"), { status: 206 });
      if (range === "bytes=8-15") return new Response(bytes("GRIB2met"), { status: 206 });
      return new Response("unexpected range", { status: 416 });
    }) as typeof fetch;

    const cache = new AifsOpenDataSubsetCache(
      root,
      fetchFn,
      2,
      immediatePolicy,
      immediatePolicy,
    );

    const temperature = await cache.fetchSelection({
      run,
      forecastHour: 6,
      selectors: [
        { key: "temperature@850", param: "t", levtype: "pl", levelist: 850 },
      ],
    });
    expect(temperature.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(temperature.path))).toBe("GRIBtemp");

    const surfaceTemperature = await cache.fetchSelection({
      run,
      forecastHour: 6,
      selectors: [
        { key: "temperature_2m", param: "2t", levtype: "sfc" },
      ],
    });
    expect(surfaceTemperature.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(surfaceTemperature.path))).toBe("GRIB2met");

    const cached = await cache.fetchSelection({
      run,
      forecastHour: 6,
      selectors: [
        { key: "temperature@850", param: "t", levtype: "pl", levelist: 850 },
      ],
    });
    expect(cached.cacheHit).toBe(true);
    expect(cached.path).toBe(temperature.path);
    expect(indexCalls).toBe(1);
    expect(rangeCalls).toBe(2);
  });

  it("coalesces concurrent identical subset downloads", async () => {
    const root = await tempRoot();
    let releaseRange!: () => void;
    const rangeGate = new Promise<void>((resolve) => { releaseRange = resolve; });
    let rangeCalls = 0;

    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(".index")) {
        return new Response(
          '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","_offset":0,"_length":8}',
          { status: 200 },
        );
      }
      rangeCalls += 1;
      await rangeGate;
      return new Response(bytes("GRIBtemp"), { status: 206 });
    }) as typeof fetch;

    const cache = new AifsOpenDataSubsetCache(
      root,
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

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.path).toBe(secondResult.path);
    expect([firstResult.cacheHit, secondResult.cacheHit].sort()).toEqual([false, true]);
    expect(rangeCalls).toBe(1);
  });

  it("rejects empty selections and reports failures across all mirrors", async () => {
    const root = await tempRoot();
    const cache = new AifsOpenDataSubsetCache(
      root,
      vi.fn(async () => new Response("bad", {
        status: 400,
        statusText: "Bad Request",
      })) as typeof fetch,
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
  });

  it("rejects non-GRIB range bodies", async () => {
    const root = await tempRoot();
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(".index")) {
        return new Response(
          '{"date":"20260831","time":"0000","step":"6","levtype":"pl","levelist":"850","param":"t","_offset":0,"_length":8}',
          { status: 200 },
        );
      }
      return new Response(bytes("NOTGRIB!"), { status: 206 });
    }) as typeof fetch;

    const cache = new AifsOpenDataSubsetCache(
      root,
      fetchFn,
      1,
      immediatePolicy,
      immediatePolicy,
    );

    await expect(cache.fetchSelection({
      run,
      forecastHour: 6,
      selectors: [
        { key: "temperature@850", param: "t", levtype: "pl", levelist: 850 },
      ],
    })).rejects.toThrow("failed across all configured mirrors");
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wfg-aifs-cache-"));
  roots.push(root);
  return root;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
