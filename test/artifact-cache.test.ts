import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileArtifactCache } from "../src/cache/artifact-cache.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileArtifactCache", () => {
  it("reuses a pre-existing immutable text artifact without invoking the loader", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "legacy.csv"), "cached\nvalue", "utf8");
    const loader = vi.fn(async () => "remote\nvalue");
    const cache = new FileArtifactCache(root);

    const result = await cache.getOrCreateText("legacy.csv", loader);

    expect(result).toEqual({ value: "cached\nvalue", cacheHit: true });
    expect(loader).not.toHaveBeenCalled();
  });

  it("stores a text miss atomically and reuses it on the next call", async () => {
    const root = await tempRoot();
    const loader = vi.fn(async () => "a,b\n1,2");
    const cache = new FileArtifactCache(root);

    const first = await cache.getOrCreateText("sample.csv", loader);
    const second = await cache.getOrCreateText("sample.csv", loader);

    expect(first).toEqual({ value: "a,b\n1,2", cacheHit: false });
    expect(second).toEqual({ value: "a,b\n1,2", cacheHit: true });
    expect(loader).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent misses for the same artifact", async () => {
    const root = await tempRoot();
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const loader = vi.fn(async () => {
      markStarted();
      await gate;
      return new Uint8Array([1, 2, 3]);
    });
    const cache = new FileArtifactCache(root);

    const firstPromise = cache.getOrCreateBytes("sample.zip", loader);
    await started;
    const secondPromise = cache.getOrCreateBytes("sample.zip", loader);
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect([...first.value]).toEqual([1, 2, 3]);
    expect([...second.value]).toEqual([1, 2, 3]);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("refreshes an artifact after its TTL expires", async () => {
    const root = await tempRoot();
    const path = join(root, "expiring.txt");
    await writeFile(path, "old", "utf8");
    const old = new Date(Date.now() - 10_000);
    await utimes(path, old, old);
    const loader = vi.fn(async () => "new");
    const cache = new FileArtifactCache(root);

    const result = await cache.getOrCreateText("expiring.txt", loader, 1_000);

    expect(result).toEqual({ value: "new", cacheHit: false });
    expect(loader).toHaveBeenCalledOnce();
  });

  it("rejects path traversal and invalid TTLs at the storage boundary", async () => {
    const root = await tempRoot();
    const cache = new FileArtifactCache(root);

    for (const name of [".", "..", "../escape"]) {
      await expect(cache.getOrCreateText(name, async () => "x")).rejects.toThrow(
        /single non-dot path segment/,
      );
    }
    await expect(cache.getOrCreateText("x", async () => "x", -1)).rejects.toThrow(
      /ttlMs must be non-negative/,
    );
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wfg-artifact-cache-"));
  roots.push(root);
  return root;
}
