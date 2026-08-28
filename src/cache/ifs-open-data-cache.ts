import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "./file-access-policy.js";
import {
  buildIfsOpenDataForecastIndexUrl,
  buildIfsOpenDataForecastUrl,
  fetchIfsWithRetry,
  IFS_OPEN_DATA_MIRRORS,
  parseIfsOpenDataIndex,
  selectIfsIndexEntries,
  type IfsIndexSelector,
  type IfsOpenDataProduct,
} from "../sources/ifs-open-data.js";

export interface IfsSelectionRequest {
  run: Date;
  forecastHour: number;
  selectors: readonly IfsIndexSelector[];
  product?: IfsOpenDataProduct;
}

export interface IfsSubsetFile {
  path: string;
  cacheHit: boolean;
}

export interface IfsSelectionSource {
  fetchSelection(request: IfsSelectionRequest): Promise<IfsSubsetFile>;
}

export class IfsOpenDataSubsetCache implements IfsSelectionSource {
  private readonly inFlight = new Map<string, Promise<IfsSubsetFile>>();
  private readonly indexInFlight = new Map<string, Promise<string>>();
  private readonly cloudAccessPolicy: UpstreamAccessPolicy;
  private readonly directAccessPolicy: UpstreamAccessPolicy;

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly rangeConcurrency = 3,
    cloudAccessPolicy?: UpstreamAccessPolicy,
    directAccessPolicy?: UpstreamAccessPolicy,
  ) {
    const stateDir = join(rootDir, "access-state");
    this.cloudAccessPolicy = cloudAccessPolicy
      ?? new FileAccessPolicy(stateDir, UPSTREAM_ACCESS_POLICIES.ecmwfCloud);
    this.directAccessPolicy = directAccessPolicy
      ?? new FileAccessPolicy(stateDir, UPSTREAM_ACCESS_POLICIES.ecmwfDirect);
  }

  async fetchSelection(request: IfsSelectionRequest): Promise<IfsSubsetFile> {
    if (request.selectors.length === 0) throw new Error("IFS subset request selected no fields");
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

  private async download(request: IfsSelectionRequest, path: string): Promise<IfsSubsetFile> {
    const failures: string[] = [];
    for (const mirror of IFS_OPEN_DATA_MIRRORS) {
      try {
        return await this.downloadFromMirror(request, path, mirror.baseUrl);
      } catch (error) {
        failures.push(`${mirror.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(
      `ECMWF IFS selected-field download failed across all configured mirrors: ${failures.join(" | ")}`,
    );
  }

  private async downloadFromMirror(
    request: IfsSelectionRequest,
    path: string,
    baseUrl: string,
  ): Promise<IfsSubsetFile> {
    const product = request.product ?? "oper-fc";
    const gribUrl = buildIfsOpenDataForecastUrl(request.run, request.forecastHour, baseUrl, product);
    const indexUrl = buildIfsOpenDataForecastIndexUrl(request.run, request.forecastHour, baseUrl, product);
    const entries = parseIfsOpenDataIndex(await this.fetchIndex(indexUrl));
    const selected = selectIfsIndexEntries(entries, request.selectors);
    const chunks = await mapConcurrent(selected, this.rangeConcurrency, async (entry) => {
      const length = entry.length;
      if (length === undefined) throw new Error("ECMWF IFS index entry is missing byte length");
      return this.fetchRange(gribUrl, entry.offset, length);
    });

    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const tempPath = `${path}.${process.pid}.tmp`;
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
      // ECMWF Open Data forecast files are immutable once published.
    }

    const pending = this.indexInFlight.get(key);
    if (pending) return pending;

    const operation = this.downloadIndex(url, path)
      .finally(() => this.indexInFlight.delete(key));
    this.indexInFlight.set(key, operation);
    return operation;
  }

  private async downloadIndex(url: string, path: string): Promise<string> {
    const text = await this.accessPolicyForUrl(url).run(async () => {
      const response = await fetchIfsWithRetry(this.fetchFn, url, {
        headers: { "user-agent": "weather-for-grown-ups/0.2" },
      });
      if (!response.ok) {
        throw new Error(
          `ECMWF IFS index request failed: HTTP ${response.status} ${response.statusText} for ${url}`,
        );
      }
      return response.text();
    });
    await writeFile(path, text, "utf8");
    return text;
  }

  private async fetchRange(url: string, start: number, length: number): Promise<Uint8Array> {
    const end = start + length - 1;
    const rangeValue = `bytes=${start}-${end}`;
    return this.accessPolicyForUrl(url).run(async () => {
      const response = await fetchIfsWithRetry(this.fetchFn, url, {
        headers: {
          range: rangeValue,
          "user-agent": "weather-for-grown-ups/0.2",
        },
      });
      if (response.status !== 206) {
        throw new Error(
          `ECMWF IFS range request failed: HTTP ${response.status} ${response.statusText} for ${rangeValue}`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
        throw new Error(`ECMWF IFS range did not start with a GRIB message (${rangeValue})`);
      }
      return bytes;
    });
  }

  private accessPolicyForUrl(url: string): UpstreamAccessPolicy {
    const directBaseUrl = IFS_OPEN_DATA_MIRRORS.find((mirror) => mirror.id === "ecmwf")?.baseUrl;
    return directBaseUrl !== undefined && url.startsWith(directBaseUrl)
      ? this.directAccessPolicy
      : this.cloudAccessPolicy;
  }
}

function subsetKey(request: IfsSelectionRequest): string {
  return createHash("sha256").update(JSON.stringify({
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    product: request.product ?? "oper-fc",
    selectors: request.selectors.map((selector) => ({
      key: selector.key,
      param: selector.param,
      levtype: selector.levtype,
      ...(selector.levelist === undefined ? {} : { levelist: selector.levelist }),
      ...(selector.number === undefined ? {} : { number: selector.number }),
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
