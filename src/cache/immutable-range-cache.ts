import { createHash } from "node:crypto";
import { FileArtifactCache } from "./artifact-cache.js";

/**
 * Persistent cache for immutable byte ranges inside published provider objects.
 *
 * Query-level subset caches remain useful assembled artifacts, but they are not the
 * reusable data unit: overlapping selections should reuse already-downloaded GRIB
 * messages. Provider/network behavior stays in the loader supplied by the caller.
 */
export class ImmutableRangeCache {
  private readonly artifacts: FileArtifactCache;

  constructor(rootDir: string) {
    this.artifacts = new FileArtifactCache(rootDir);
  }

  async getOrCreate(
    url: string,
    start: number,
    length: number,
    loader: () => Promise<Uint8Array>,
  ): Promise<Uint8Array> {
    if (!Number.isSafeInteger(start) || start < 0) throw new Error("range start must be a non-negative integer");
    if (!Number.isSafeInteger(length) || length <= 0) throw new Error("range length must be a positive integer");
    const identity = JSON.stringify({ url, start, length });
    const name = `${createHash("sha256").update(identity).digest("hex")}.range`;
    return (await this.artifacts.getOrCreateBytes(name, loader)).value;
  }
}
