import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IfsOpenDataSubsetCache } from "../src/cache/ifs-open-data-cache.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("IFS selected-message cache", () => {
  it("fetches exact ECMWF index ranges in selector order and reuses immutable cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-ifs-cache-"));
    roots.push(root);
    const index = [
      '{"date":"20260827","time":"1200","step":"6","levtype":"pl","levelist":"850","param":"t","_offset":100,"_length":4}',
      '{"date":"20260827","time":"1200","step":"6","levtype":"sfc","param":"2t","_offset":200,"_length":4}',
    ].join("\n");
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith(".index")) return new Response(index, { status: 200 });
      const range = (init?.headers as Record<string, string> | undefined)?.range;
      expect(range === "bytes=100-103" || range === "bytes=200-203").toBe(true);
      return new Response(new TextEncoder().encode("GRIB"), { status: 206 });
    }) as typeof fetch;
    const cache = new IfsOpenDataSubsetCache(root, fetchFn, 1);
    const request = {
      run: new Date("2026-08-27T12:00:00Z"),
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
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("fails over the complete indexed range download when the primary mirror is throttled", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-ifs-failover-"));
    roots.push(root);
    const index = '{"date":"20260827","time":"1200","step":"6","levtype":"pl","levelist":"850","param":"t","_offset":0,"_length":4}';
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("ecmwf-forecasts.s3.eu-central-1.amazonaws.com")) {
        return new Response("Slow Down", { status: 503, headers: { "retry-after": "0" } });
      }
      if (url.endsWith(".index")) return new Response(index, { status: 200 });
      expect((init?.headers as Record<string, string> | undefined)?.range).toBe("bytes=0-3");
      return new Response(new TextEncoder().encode("GRIB"), { status: 206 });
    }) as typeof fetch;
    const cache = new IfsOpenDataSubsetCache(root, fetchFn, 1);

    const result = await cache.fetchSelection({
      run: new Date("2026-08-27T12:00:00Z"),
      forecastHour: 6,
      selectors: [{ key: "temperature@850", param: "t", levtype: "pl", levelist: 850 }],
    });

    expect(result.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(result.path))).toBe("GRIB");
    expect(fetchFn.mock.calls.some(([input]) =>
      String(input).includes("ai4edataeuwest.blob.core.windows.net"))).toBe(true);
  });
});
