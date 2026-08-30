import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import {
  mergeByteRanges,
  parseGribIndex,
  selectNonIsobaricByteRanges,
  selectPressureByteRanges,
  type ByteRange,
} from "../grib/index.js";
import { buildGfsS3ForecastIndexUrl, buildGfsS3ForecastUrl } from "../sources/gfs-s3.js";
import {
  DEFAULT_HTTP_RETRY_MAX_ATTEMPTS,
  isRetryableHttpStatus,
  waitBeforeHttpRetry,
} from "../access/http-retry.js";
import type { ProfileDataRequest, ProfileSourceFile } from "../sources/types.js";

export class GfsS3SubsetCache {
  private readonly inFlight = new Map<string, Promise<ProfileSourceFile>>();

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly rangeConcurrency: number = UPSTREAM_ACCESS_POLICIES.noaaAws.maxConcurrency,
    private readonly accessPolicy: UpstreamAccessPolicy = new FileAccessPolicy(
      join(rootDir, "access-state"),
      UPSTREAM_ACCESS_POLICIES.noaaAws,
    ),
  ) {}

  async fetch(request: ProfileDataRequest): Promise<ProfileSourceFile> {
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

  private async download(request: ProfileDataRequest, path: string): Promise<ProfileSourceFile> {
    const grid = request.grid ?? "0p25";
    const gribUrl = buildGfsS3ForecastUrl(request.run, request.forecastHour, grid);
    const indexUrl = buildGfsS3ForecastIndexUrl(request.run, request.forecastHour, grid);
    const indexText = await this.fetchIndex(indexUrl);
    const records = parseGribIndex(indexText);
    const pressureRanges = selectPressureByteRanges(
      records,
      request.variables.map((variable) => variable.gfsCode),
      request.pressureLevelsHpa,
    );
    const fieldRanges = selectNonIsobaricByteRanges(records, request.fields ?? []);
    const ranges = mergeByteRanges(pressureRanges, fieldRanges);

    const chunks = await mapConcurrent(
      ranges,
      this.rangeConcurrency,
      (range) => this.fetchRange(gribUrl, range),
    );
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
    const path = join(this.rootDir, `${key}.idx`);
    try {
      return await readFile(path, "utf8");
    } catch {
      // Immutable index files are fetched once and then reused locally.
    }

    for (let attempt = 1; attempt <= DEFAULT_HTTP_RETRY_MAX_ATTEMPTS; attempt += 1) {
      const result = await this.accessPolicy.run(async () => {
        const response = await this.fetchFn(url, {
          headers: { "user-agent": "weather-for-grown-ups/0.1" },
        });
        return {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get("retry-after"),
          text: response.ok ? await response.text() : undefined,
        };
      });

      if (isRetryableHttpStatus(result.status) && attempt < DEFAULT_HTTP_RETRY_MAX_ATTEMPTS) {
        await waitBeforeHttpRetry(attempt, result.retryAfter);
        continue;
      }
      if (result.status < 200 || result.status >= 300 || result.text === undefined) {
        throw new Error(`NOAA AWS index request failed: HTTP ${result.status} ${result.statusText}`);
      }
      await writeFile(path, result.text, "utf8");
      return result.text;
    }

    throw new Error("NOAA AWS index retry loop exhausted unexpectedly");
  }

  private async fetchRange(url: string, range: ByteRange): Promise<Uint8Array> {
    const rangeValue = `bytes=${range.start}-${range.end ?? ""}`;

    for (let attempt = 1; attempt <= DEFAULT_HTTP_RETRY_MAX_ATTEMPTS; attempt += 1) {
      const result = await this.accessPolicy.run(async () => {
        const response = await this.fetchFn(url, {
          headers: {
            range: rangeValue,
            "user-agent": "weather-for-grown-ups/0.1",
          },
        });
        return {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get("retry-after"),
          bytes: response.status === 206
            ? new Uint8Array(await response.arrayBuffer())
            : undefined,
        };
      });

      if (isRetryableHttpStatus(result.status) && attempt < DEFAULT_HTTP_RETRY_MAX_ATTEMPTS) {
        await waitBeforeHttpRetry(attempt, result.retryAfter);
        continue;
      }
      if (result.status !== 206 || result.bytes === undefined) {
        throw new Error(`NOAA AWS range request failed: HTTP ${result.status} ${result.statusText}`);
      }
      if (
        result.bytes.length < 4
        || new TextDecoder().decode(result.bytes.slice(0, 4)) !== "GRIB"
      ) {
        throw new Error(`NOAA AWS range did not start with a GRIB message (${rangeValue})`);
      }
      return result.bytes;
    }

    throw new Error("NOAA AWS range retry loop exhausted unexpectedly");
  }
}

function subsetKey(request: ProfileDataRequest): string {
  const canonical = JSON.stringify({
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    grid: request.grid ?? "0p25",
    variables: [...new Set(request.variables.map((variable) => variable.gfsCode))].sort(),
    pressureLevelsHpa: [...new Set(request.pressureLevelsHpa)].sort((a, b) => b - a),
    fields: [...new Set((request.fields ?? []).map((field) => field.id))].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<U>,
): Promise<U[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("NOAA AWS range concurrency must be a positive integer");
  }
  const result = new Array<U>(values.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      result[index] = await fn(values[index]!);
    }
  }

  const workerCount = Math.min(concurrency, values.length);
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
