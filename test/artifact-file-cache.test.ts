import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileArtifactCache } from "../src/cache/artifact-cache.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileArtifactCache file materialization", () => {
  it("materializes a byte payload once and returns its path without rereading it on hits", async () => {
    const root = await tempRoot();
    const loader = vi.fn(async () => new TextEncoder().encode("GRIBpayload"));
    const cache = new FileArtifactCache(root);

    const first = await cache.getOrCreateFile("sample.grib2", loader);
    const second = await cache.getOrCreateFile("sample.grib2", loader);

    expect(first.cacheHit).toBe(false);
    expect(second).toEqual({ path: first.path, cacheHit: true });
    expect(loader).toHaveBeenCalledOnce();
    expect(Buffer.from(await readFile(first.path)).toString()).toBe("GRIBpayload");
  });

  it("deduplicates concurrent file materialization and marks the follower as a cache hit", async () => {
    const root = await tempRoot();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const loader = vi.fn(async () => {
      started();
      await gate;
      return new Uint8Array([1, 2, 3]);
    });
    const cache = new FileArtifactCache(root);

    const firstPromise = cache.getOrCreateFile("sample.bin", loader);
    await startedPromise;
    const secondPromise = cache.getOrCreateFile("sample.bin", loader);
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.path).toBe(second.path);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(loader).toHaveBeenCalledOnce();
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wfg-artifact-file-cache-"));
  roots.push(root);
  return root;
}
