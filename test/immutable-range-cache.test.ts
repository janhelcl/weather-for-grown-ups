import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ImmutableRangeCache } from "../src/cache/immutable-range-cache.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("immutable range cache", () => {
  it("reuses the provider object + byte range independently of query selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-range-cache-"));
    roots.push(root);
    const cache = new ImmutableRangeCache(root);
    let calls = 0;
    const load = async () => {
      calls += 1;
      return new TextEncoder().encode("GRIBdata");
    };

    const first = await cache.getOrCreate("https://example.test/file.grib2", 100, 8, load);
    const second = await cache.getOrCreate("https://example.test/file.grib2", 100, 8, load);
    expect(new TextDecoder().decode(first)).toBe("GRIBdata");
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it("keeps distinct ranges distinct", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-range-cache-"));
    roots.push(root);
    const cache = new ImmutableRangeCache(root);
    let calls = 0;
    const loader = async () => new Uint8Array([++calls]);
    expect(await cache.getOrCreate("https://example.test/file", 0, 4, loader)).toEqual(new Uint8Array([1]));
    expect(await cache.getOrCreate("https://example.test/file", 4, 4, loader)).toEqual(new Uint8Array([2]));
    expect(calls).toBe(2);
  });
});
