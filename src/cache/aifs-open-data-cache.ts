import { upstreamHttpFailure } from "../access/http-failure.js";
import { WFG_USER_AGENT } from "../access/user-agent.js";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UpstreamAccessPolicy } from "../access/access-policy.js";
import {
  IfsOpenDataAccessPolicy,
  runIfsHttpWithRetry,
  type IfsHttpAccessPolicy,
} from "../access/ifs-open-data.js";
import {
  IFS_OPEN_DATA_MIRRORS,
  parseIfsOpenDataIndex,
  selectIfsIndexEntries,
  type IfsIndexSelector,
} from "../sources/ifs-open-data.js";
import {
  buildAifsOpenDataForecastIndexUrl,
  buildAifsOpenDataForecastUrl,
} from "../sources/aifs-open-data.js";

export interface AifsSelectionRequest {
  run: Date;
  forecastHour: number;
  selectors: readonly IfsIndexSelector[];
}

export interface AifsSubsetFile {
  path: string;
  cacheHit: boolean;
}

export interface AifsSelectionSource {
  fetchSelection(request: AifsSelectionRequest): Promise<AifsSubsetFile>;
}

export class AifsOpenDataSubsetCache implements AifsSelectionSource {
  private readonly inFlight = new Map<string, Promise<AifsSubsetFile>>();
  private readonly indexInFlight = new Map<string, Promise<string>>();
  private readonly accessPolicy: IfsHttpAccessPolicy;

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly rangeConcurrency = 3,
    cloudAccessPolicy?: UpstreamAccessPolicy,
    directAccessPolicy?: UpstreamAccessPolicy,
  ) {
    this.accessPolicy = new IfsOpenDataAccessPolicy(
      join(rootDir, "access-state"),
      cloudAccessPolicy,
      directAccessPolicy,
    );
  }

  async fetchSelection(request: AifsSelectionRequest): Promise<AifsSubsetFile> {
    if (request.selectors.length === 0) throw new Error("AIFS subset request selected no fields");
    await mkdir(this.rootDir, { recursive: true });
    const key = subsetKey(request);
    const path = join(this.rootDir, `${key}.grib2`);
    if (await exists(path)) return { path, cacheHit: true };

    const pending = this.inFlight.get(key);
    if (pending) {
      const result = await pending;
      return { ...result, cacheHit: true };
    }

    const operation = this.download(request, path).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  private async download(request: AifsSelectionRequest, path: string): Promise<AifsSubsetFile> {
    const failures: string[] = [];
    for (const mirror of IFS_OPEN_DATA_MIRRORS) {
      try {
        return await this.downloadFromMirror(request, path, mirror.baseUrl);
      } catch (error) {
        failures.push(`${mirror.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(
      `ECMWF AIFS selected-field download failed across all configured mirrors: ${failures.join(" | ")}`,
    );
  }

  private async downloadFromMirror(
    request: AifsSelectionRequest,
    path: string,
    baseUrl: string,
  ): Promise<AifsSubsetFile> {
    const gribUrl = buildAifsOpenDataForecastUrl(request.run, request.forecastHour, baseUrl);
    const indexUrl = buildAifsOpenDataForecastIndexUrl(request.run, request.forecastHour, baseUrl);
    const entries = parseIfsOpenDataIndex(await this.fetchIndex(indexUrl));
    const selected = selectIfsIndexEntries(entries, request.selectors);
    const chunks = await mapConcurrent(selected, this.rangeConcurrency, async (entry) => {
      const length = entry.length;
      if (length === undefined) throw new Error("ECMWF AIFS index entry is missing byte length");
      return this.fetchRange(gribUrl, entry.offset, length);
    });

    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, combined);
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
    return { path, cacheHit: false };
  }

  private async fetchIndex(url: string): Promise<string> {
    const key = createHash("sha256").update(url).digest("hex");
    const path = join(this.rootDir, `${key}.index`);
    try {
      return await readFile(path, "utf8");
    } catch {
      // Published Open Data forecast files are immutable.
    }
    const pending = this.indexInFlight.get(key);
    if (pending) return pending;

    const operation = this.downloadIndex(url, path).finally(() => this.indexInFlight.delete(key));
    this.indexInFlight.set(key, operation);
    return operation;
  }

  private async downloadIndex(url: string, path: string): Promise<string> {
    const result = await runIfsHttpWithRetry(() =>
      this.accessPolicy.run(url, async () => {
        const response = await this.fetchFn(url, {
          headers: { "user-agent": WFG_USER_AGENT },
        });
        return {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get("retry-after"),
          ...(response.ok ? { value: await response.text() } : {}),
        };
      }),
    );
    if (result.status < 200 || result.status >= 300 || result.value === undefined) {
      throw upstreamHttpFailure({
        provider: "ECMWF Open Data",
        operation: "AIFS index request",
        status: result.status,
        statusText: result.statusText,
        resource: "the requested AIFS forecast file",
        url,
      });
    }
    await writeFile(path, result.value, "utf8");
    return result.value;
  }

  private async fetchRange(url: string, start: number, length: number): Promise<Uint8Array> {
    const end = start + length - 1;
    const rangeValue = `bytes=${start}-${end}`;
    const result = await runIfsHttpWithRetry(() =>
      this.accessPolicy.run(url, async () => {
        const response = await this.fetchFn(url, {
          headers: {
            range: rangeValue,
            "user-agent": WFG_USER_AGENT,
          },
        });
        return {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get("retry-after"),
          ...(response.status === 206
            ? { value: new Uint8Array(await response.arrayBuffer()) }
            : {}),
        };
      }),
    );
    if (result.status !== 206 || result.value === undefined) {
      throw upstreamHttpFailure({
        provider: "ECMWF Open Data",
        operation: "AIFS byte-range request",
        status: result.status,
        statusText: result.statusText,
        details: { range: rangeValue },
      });
    }
    if (
      result.value.length < 4
      || new TextDecoder().decode(result.value.slice(0, 4)) !== "GRIB"
    ) {
      throw new Error(`ECMWF AIFS range did not start with a GRIB message (${rangeValue})`);
    }
    return result.value;
  }
}

function subsetKey(request: AifsSelectionRequest): string {
  return createHash("sha256").update(JSON.stringify({
    model: "aifs-single",
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    selectors: request.selectors.map((selector) => ({
      key: selector.key,
      param: selector.param,
      levtype: selector.levtype,
      ...(selector.levelist === undefined ? {} : { levelist: selector.levelist }),
    })),
  })).digest("hex");
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<U>,
): Promise<U[]> {
  const result = new Array<U>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      result[index] = await fn(values[index]!);
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, values.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
