import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import type { GefsMember } from "../catalog/gefs.js";
import type { GfsCode } from "../catalog/variables.js";
import {
  mergeByteRanges,
  parseGribIndex,
  selectNonIsobaricByteRanges,
  selectPressureByteRanges,
  type ByteRange,
  type NonIsobaricGribSelector,
} from "../grib/index.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import {
  buildGefsS3ForecastIndexUrl,
  buildGefsS3ForecastUrl,
  gefsAtmosProductForSelection,
  type GefsAtmosProduct,
} from "../sources/gefs-s3.js";

export interface GefsMemberDataRequest {
  run: Date;
  forecastHour: number;
  member: GefsMember;
  variableCode: GfsCode;
  pressureLevelHpa: number;
}

export interface GefsMemberSelectionDataRequest {
  run: Date;
  forecastHour: number;
  member: GefsMember;
  variableCodes: GfsCode[];
  pressureLevelsHpa: number[];
  fields?: NonIsobaricGribSelector[];
  product?: GefsAtmosProduct;
}

export interface GefsSubsetFile {
  path: string;
  cacheHit: boolean;
}

export interface GefsMemberSource {
  fetch(request: GefsMemberDataRequest): Promise<GefsSubsetFile>;
}

export interface GefsMemberSelectionSource {
  fetchSelection(request: GefsMemberSelectionDataRequest): Promise<GefsSubsetFile>;
}

export class GefsS3SubsetCache implements GefsMemberSource, GefsMemberSelectionSource {
  private readonly inFlight = new Map<string, Promise<GefsSubsetFile>>();

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly accessPolicy: UpstreamAccessPolicy = new FileAccessPolicy(
      join(rootDir, "access-state"),
      UPSTREAM_ACCESS_POLICIES.noaaAws,
    ),
  ) {}

  async fetch(request: GefsMemberDataRequest): Promise<GefsSubsetFile> {
    return this.fetchCached(
      subsetKey(request),
      request,
      [request.variableCode],
      [request.pressureLevelHpa],
      [],
      "pgrb2a_0p50",
    );
  }

  async fetchSelection(request: GefsMemberSelectionDataRequest): Promise<GefsSubsetFile> {
    const variableCodes = [...new Set(request.variableCodes)].sort();
    const pressureLevelsHpa = [...new Set(request.pressureLevelsHpa)].sort((a, b) => a - b);
    const fields = canonicalFields(request.fields ?? []);
    const product = request.product ?? gefsAtmosProductForSelection(
      variableCodes.length > 0 || pressureLevelsHpa.length > 0,
      request.forecastHour,
    );
    return this.fetchCached(
      selectionSubsetKey({ ...request, variableCodes, pressureLevelsHpa, fields, product }),
      request,
      variableCodes,
      pressureLevelsHpa,
      fields,
      product,
    );
  }

  private async fetchCached(
    key: string,
    request: Pick<GefsMemberDataRequest, "run" | "forecastHour" | "member">,
    variableCodes: GfsCode[],
    pressureLevelsHpa: number[],
    fields: NonIsobaricGribSelector[],
    product: GefsAtmosProduct,
  ): Promise<GefsSubsetFile> {
    await mkdir(this.rootDir, { recursive: true });
    const path = join(this.rootDir, `${key}.grib2`);
    if (await exists(path)) return { path, cacheHit: true };

    const pending = this.inFlight.get(key);
    if (pending) {
      const result = await pending;
      return { ...result, cacheHit: true };
    }

    const operation = this.download(request, variableCodes, pressureLevelsHpa, fields, product, path)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  private async download(
    request: Pick<GefsMemberDataRequest, "run" | "forecastHour" | "member">,
    variableCodes: GfsCode[],
    pressureLevelsHpa: number[],
    fields: NonIsobaricGribSelector[],
    product: GefsAtmosProduct,
    path: string,
  ): Promise<GefsSubsetFile> {
    const gribUrl = buildGefsS3ForecastUrl(request.run, request.forecastHour, request.member, product);
    const indexUrl = buildGefsS3ForecastIndexUrl(request.run, request.forecastHour, request.member, product);
    const records = parseGribIndex(await this.fetchIndex(indexUrl));
    const ranges = mergeByteRanges(
      selectPressureByteRanges(records, variableCodes, pressureLevelsHpa),
      selectNonIsobaricByteRanges(records, fields),
    );
    if (ranges.length === 0) throw new Error("GEFS subset request selected no GRIB messages");
    // Keep range fan-out bounded by fetching one selected GRIB message at a time per member.
    // Member-first services already run members concurrently, so this prevents field count
    // from multiplying aggregate AWS request concurrency.
    const chunks: Uint8Array[] = [];
    for (const range of ranges) chunks.push(await this.fetchRange(gribUrl, range));
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
      // Forecast inventories are immutable after publication and can be reused indefinitely.
    }

    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": "weather-for-grown-ups/0.1" } },
      { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
    );
    if (!response.ok) {
      throw new Error(`NOAA GEFS AWS index request failed: HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    await writeFile(path, text, "utf8");
    return text;
  }

  private async fetchRange(url: string, range: ByteRange): Promise<Uint8Array> {
    const rangeValue = `bytes=${range.start}-${range.end ?? ""}`;
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          range: rangeValue,
          "user-agent": "weather-for-grown-ups/0.1",
        },
      },
      { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
    );
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

function selectionSubsetKey(request: GefsMemberSelectionDataRequest): string {
  const fields = canonicalFields(request.fields ?? []);
  return createHash("sha256").update(JSON.stringify({
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    member: request.member,
    variableCodes: request.variableCodes,
    pressureLevelsHpa: request.pressureLevelsHpa,
    product: request.product ?? gefsAtmosProductForSelection(
      request.variableCodes.length > 0 || request.pressureLevelsHpa.length > 0,
      request.forecastHour,
    ),
    ...(fields.length === 0 ? {} : {
      fields: fields.map((field) => ({
        id: field.id,
        gfsCode: field.gfsCode,
        gribLevel: field.level.gribLevel,
        temporalSemantics: field.temporalSemantics,
      })),
    }),
  })).digest("hex");
}

function canonicalFields(fields: NonIsobaricGribSelector[]): NonIsobaricGribSelector[] {
  return [...fields].sort((left, right) =>
    `${left.id}|${left.gfsCode}|${left.level.gribLevel}|${left.temporalSemantics}`
      .localeCompare(`${right.id}|${right.gfsCode}|${right.level.gribLevel}|${right.temporalSemantics}`));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
