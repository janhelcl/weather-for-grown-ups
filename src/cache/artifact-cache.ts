import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CachedArtifact<T> {
  value: T;
  cacheHit: boolean;
}

/**
 * Filesystem-backed artifact persistence only. Provider access, retries and
 * upstream etiquette stay outside this class.
 */
export class FileArtifactCache {
  private readonly textInFlight = new Map<string, Promise<string>>();
  private readonly bytesInFlight = new Map<string, Promise<Uint8Array>>();

  constructor(private readonly rootDir: string) {}

  async getOrCreateText(
    name: string,
    loader: () => Promise<string>,
    ttlMs = Number.POSITIVE_INFINITY,
  ): Promise<CachedArtifact<string>> {
    const path = this.path(name);
    if (await isFresh(path, ttlMs)) {
      return { value: await readFile(path, "utf8"), cacheHit: true };
    }

    const pending = this.textInFlight.get(name);
    if (pending !== undefined) {
      return { value: await pending, cacheHit: true };
    }

    const operation = this.loadAndStoreText(path, loader)
      .finally(() => this.textInFlight.delete(name));
    this.textInFlight.set(name, operation);
    return { value: await operation, cacheHit: false };
  }

  async getOrCreateBytes(
    name: string,
    loader: () => Promise<Uint8Array>,
    ttlMs = Number.POSITIVE_INFINITY,
  ): Promise<CachedArtifact<Uint8Array>> {
    const path = this.path(name);
    if (await isFresh(path, ttlMs)) {
      return { value: new Uint8Array(await readFile(path)), cacheHit: true };
    }

    const pending = this.bytesInFlight.get(name);
    if (pending !== undefined) {
      return { value: await pending, cacheHit: true };
    }

    const operation = this.loadAndStoreBytes(path, loader)
      .finally(() => this.bytesInFlight.delete(name));
    this.bytesInFlight.set(name, operation);
    return { value: await operation, cacheHit: false };
  }

  private async loadAndStoreText(path: string, loader: () => Promise<string>): Promise<string> {
    await mkdir(this.rootDir, { recursive: true });
    const value = await loader();
    await writeAtomically(path, value);
    return value;
  }

  private async loadAndStoreBytes(
    path: string,
    loader: () => Promise<Uint8Array>,
  ): Promise<Uint8Array> {
    await mkdir(this.rootDir, { recursive: true });
    const value = await loader();
    await writeAtomically(path, value);
    return value;
  }

  private path(name: string): string {
    if (name.length === 0 || name.includes("/") || name.includes("\\")) {
      throw new Error("artifact cache name must be a single path segment");
    }
    return join(this.rootDir, name);
  }
}

async function writeAtomically(path: string, value: string | Uint8Array): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, value);
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function isFresh(path: string, ttlMs: number): Promise<boolean> {
  if (ttlMs < 0 || Number.isNaN(ttlMs)) {
    throw new Error("artifact cache ttlMs must be non-negative");
  }
  try {
    const info = await stat(path);
    return !Number.isFinite(ttlMs) || Date.now() - info.mtimeMs <= ttlMs;
  } catch {
    return false;
  }
}
