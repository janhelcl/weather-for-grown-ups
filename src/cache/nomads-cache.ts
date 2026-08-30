import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileRateLimiter } from "./file-rate-limiter.js";

export interface CachedFile {
  path: string;
  cacheHit: boolean;
}

export class NomadsCache {
  constructor(
    private readonly rootDir: string,
    private readonly limiter: FileRateLimiter,
  ) {}

  async fetch(url: string): Promise<CachedFile> {
    await mkdir(this.rootDir, { recursive: true });
    const key = createHash("sha256").update(url).digest("hex");
    const path = join(this.rootDir, `${key}.grib2`);

    if (await exists(path)) return { path, cacheHit: true };

    return this.limiter.run(async () => {
      if (await exists(path)) return { path, cacheHit: true };

      const response = await fetch(url, {
        headers: { "user-agent": "weather-for-grown-ups/0.1" },
      });
      if (!response.ok) {
        throw new Error(`NOMADS request failed: HTTP ${response.status} ${response.statusText}`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
        const preview = new TextDecoder().decode(bytes.slice(0, 240));
        throw new Error(`NOMADS returned non-GRIB content: ${preview}`);
      }

      const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tempPath, bytes);
      await rename(tempPath, path);
      return { path, cacheHit: false };
    });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
