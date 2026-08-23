import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GefsMember } from "../catalog/gefs.js";
import type { GfsCode } from "../catalog/variables.js";
import { parseGribIndex, selectPressureByteRanges, type ByteRange } from "../grib/index.js";
import { buildGefsS3ForecastIndexUrl, buildGefsS3ForecastUrl } from "../sources/gefs-s3.js";

export interface GefsMemberDataRequest {
  run: Date;
  forecastHour: number;
  member: GefsMember;
  variableCode: GfsCode;
  pressureLevelHpa: number;
}

export interface GefsSubsetFile {
  path: string;
  cacheHit: boolean;
}

export interface GefsMemberSource {
  fetch(request: GefsMemberDataRequest): Promise<GefsSubsetFile>;
}

export class GefsS3SubsetCache implements GefsMemberSource {
  private readonly inFlight = new Map<string, Promise<GefsSubsetFile>>();

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async fetch(request: GefsMemberDataRequest): Promise<GefsSubsetFile> {
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

  private async download(request: GefsMemberDataRequest, path: string): Promise<GefsSubsetFile> {
    const gribUrl = buildGefsS3ForecastUrl(request.run, request.forecastHour, request.member);
    const indexUrl = buildGefsS3ForecastIndexUrl(request.run, request.forecastHour, request.member);
    const records = parseGribIndex(await this.fetchIndex(indexUrl));
    const ranges = selectPressureByteRanges(
      records,
      [request.variableCode],
      [request.pressureLevelHpa],
    );
    const chunks = await Promise.all(ranges.map((range) => this.fetchRange(gribUrl, range)));
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
    const path = join(this.rootDir, `${key}.idx`);
    try {
      return await readFile(path, "utf8");
    } catch {
      // GEFS forecast files are immutable after publication, so index responses cache forever locally.
    }

    const response = await this.fetchFn(url, {
      headers: { "user-agent": "weather-for-grown-ups/0.1" },
    });
    if (!response.ok) {
      throw new Error(`NOAA GEFS AWS index request failed: HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    await writeFile(path, text, "utf8");
    return text;
  }

  private async fetchRange(url: string, range: ByteRange): Promise<Uint8Array> {
    const rangeValue = `bytes=${range.start}-${range.end ?? ""}`;
    const response = await this.fetchFn(url, {
      headers: {
        range: rangeValue,
        "user-agent": "weather-for-grown-ups/0.1",
      },
    });
    if (response.status !== 206) {
      throw new Error(`NOAA GEFS AWS range request failed: HTTP ${response.status} ${response.statusText}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
      throw new Error(`NOAA GEFS AWS range did not start with a GRIB message (${rangeValue})`);
    }
    return bytes;
  }
}

function subsetKey(request: GefsMemberDataRequest): string {
  return createHash("sha256").update(JSON.stringify({
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    member: request.member,
    variableCode: request.variableCode,
    pressureLevelHpa: request.pressureLevelHpa,
  })).digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
