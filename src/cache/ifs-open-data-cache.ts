import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIfsOpenDataForecastIndexUrl,
  buildIfsOpenDataForecastUrl,
  fetchIfsWithRetry,
  parseIfsOpenDataIndex,
  selectIfsIndexEntries,
  type IfsIndexSelector,
} from "../sources/ifs-open-data.js";

export interface IfsSelectionRequest {
  run: Date;
  forecastHour: number;
  selectors: readonly IfsIndexSelector[];
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

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly rangeConcurrency = 3,
  ) {}

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
    const gribUrl = buildIfsOpenDataForecastUrl(request.run, request.forecastHour);
    const indexUrl = buildIfsOpenDataForecastIndexUrl(request.run, request.forecastHour);
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

    const response = await fetchIfsWithRetry(this.fetchFn, url, {
      headers: { "user-agent": "weather-for-grown-ups/0.2" },
    });
    if (!response.ok) {
      throw new Error(
        `ECMWF IFS index request failed: HTTP ${response.status} ${response.statusText} for ${url}`,
      );
    }
    const text = await response.text();
    await writeFile(path, text, "utf8");
    return text;
  }

  private async fetchRange(url: string, start: number, length: number): Promise<Uint8Array> {
    const end = start + length - 1;
    const rangeValue = `bytes=${start}-${end}`;
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
  }
}

function subsetKey(request: IfsSelectionRequest): string {
  return createHash("sha256").update(JSON.stringify({
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
