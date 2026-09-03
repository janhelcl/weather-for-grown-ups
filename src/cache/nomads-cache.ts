import { WFG_USER_AGENT } from "../access/user-agent.js";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UpstreamAccessPolicy } from "../access/access-policy.js";
import {
  runWithHttpRetry,
  type HttpRetryExecutionOptions,
} from "../access/http-retry.js";

export interface CachedFile {
  path: string;
  cacheHit: boolean;
}

type NomadsFetchAttempt =
  | {
      status: 200;
      retryAfter: null;
      cacheHit: true;
      stored: true;
    }
  | {
      status: number;
      retryAfter: string | null;
      statusText: string;
      cacheHit: false;
      stored: boolean;
    };

export class NomadsCache {
  constructor(
    private readonly rootDir: string,
    private readonly accessPolicy: UpstreamAccessPolicy,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly retryOptions: HttpRetryExecutionOptions = {},
  ) {}

  async fetch(url: string): Promise<CachedFile> {
    await mkdir(this.rootDir, { recursive: true });
    const key = createHash("sha256").update(url).digest("hex");
    const path = join(this.rootDir, `${key}.grib2`);

    if (await exists(path)) return { path, cacheHit: true };

    const result = await runWithHttpRetry(
      () => this.accessPolicy.run(async (): Promise<NomadsFetchAttempt> => {
        if (await exists(path)) {
          return {
            status: 200,
            retryAfter: null,
            cacheHit: true,
            stored: true,
          };
        }

        const response = await this.fetchFn(url, {
          headers: { "user-agent": WFG_USER_AGENT },
        });
        const retryAfter = response.headers.get("retry-after");
        if (!response.ok) {
          return {
            status: response.status,
            retryAfter,
            statusText: response.statusText,
            cacheHit: false,
            stored: false,
          };
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
          const preview = new TextDecoder().decode(bytes.slice(0, 240));
          throw new Error(`NOMADS returned non-GRIB content: ${preview}`);
        }

        const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(tempPath, bytes);
        await rename(tempPath, path);
        return {
          status: response.status,
          retryAfter,
          statusText: response.statusText,
          cacheHit: false,
          stored: true,
        };
      }),
      this.retryOptions,
    );

    if (result.cacheHit) return { path, cacheHit: true };
    if (!result.stored) {
      throw new Error(`NOMADS request failed: HTTP ${result.status} ${result.statusText}`);
    }
    return { path, cacheHit: false };
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
