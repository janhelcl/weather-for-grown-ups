import { createHash } from "node:crypto";
import { FileArtifactCache } from "./artifact-cache.js";

/**
 * Persistent cache for immutable byte ranges inside published provider objects.
 *
 * Query-level subset caches remain useful assembled artifacts, but they are not the
 * reusable data unit: overlapping selections should reuse already-downloaded GRIB
 * messages. Provider/network behavior stays in the loader supplied by the caller.
 *
 * The cache root is a logical provider/product namespace. For HTTP(S) locators the
 * serving origin is transport identity, not product identity, so only path + query
 * participate in the key. This lets mirror failover reuse the same immutable range.
 */
export class ImmutableRangeCache {
  private readonly artifacts: FileArtifactCache;

  constructor(rootDir: string) {
    this.artifacts = new FileArtifactCache(rootDir);
  }

  async getOrCreate(
    objectLocator: string,
    start: number,
    length: number,
    loader: () => Promise<Uint8Array>,
  ): Promise<Uint8Array> {
    if (!Number.isSafeInteger(start) || start < 0) throw new Error("range start must be a non-negative integer");
    if (!Number.isSafeInteger(length) || length <= 0) throw new Error("range length must be a positive integer");
    const identity = JSON.stringify({
      object: logicalObjectIdentity(objectLocator),
      start,
      length,
    });
    const name = `${createHash("sha256").update(identity).digest("hex")}.range`;
    return (await this.artifacts.getOrCreateBytes(name, async () => {
      const value = await loader();
      if (value.byteLength !== length) {
        throw new Error(
          `immutable range loader returned ${value.byteLength} bytes; expected ${length}`,
        );
      }
      return value;
    })).value;
  }
}

function logicalObjectIdentity(locator: string): string {
  try {
    const url = new URL(locator);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    // Non-URL identities are already logical object identities supplied by callers.
  }
  return locator;
}
