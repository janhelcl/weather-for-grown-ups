import { WFG_USER_AGENT } from "../access/user-agent.js";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import type { RawVariableDefinition } from "../catalog/variables.js";
import {
  parseGribIndex,
  selectNonIsobaricByteRanges,
  selectPressureByteRanges,
  type ByteRange,
} from "../grib/index.js";
import {
  buildAigfsNomadsIndexUrl,
  buildAigfsNomadsUrl,
  type AigfsProduct,
} from "../sources/aigfs.js";

export interface AigfsDataRequest {
  run: Date;
  forecastHour: number;
  variables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
  fields: RawNonIsobaricFieldDefinition[];
}

export interface AigfsSourceFile {
  path: string;
  cacheHit: boolean;
}

export interface AigfsAvailabilityRequirement {
  pressure: boolean;
  surface: boolean;
}

export interface AigfsAvailabilityProbe {
  isForecastAvailable(
    run: Date,
    forecastHour: number,
    requirement: AigfsAvailabilityRequirement,
  ): Promise<boolean>;
}

export interface AigfsSubsetCache extends AigfsAvailabilityProbe {
  fetch(request: AigfsDataRequest): Promise<AigfsSourceFile>;
}

export class AigfsNomadsSubsetCache implements AigfsSubsetCache {
  private readonly inFlight = new Map<string, Promise<AigfsSourceFile>>();

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly accessPolicy: UpstreamAccessPolicy = new FileAccessPolicy(
      join(rootDir, "access-state"),
      UPSTREAM_ACCESS_POLICIES.nomads,
    ),
  ) {}

  async fetch(request: AigfsDataRequest): Promise<AigfsSourceFile> {
    if (request.variables.length === 0 && request.fields.length === 0) {
      throw new Error("AIGFS subset request must contain at least one pressure variable or surface field");
    }

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

  async isForecastAvailable(
    run: Date,
    forecastHour: number,
    requirement: AigfsAvailabilityRequirement,
  ): Promise<boolean> {
    if (!requirement.pressure && !requirement.surface) return false;
    if (requirement.pressure && !(await this.hasIndex(run, forecastHour, "pres"))) return false;
    if (requirement.surface && !(await this.hasIndex(run, forecastHour, "sfc"))) return false;
    return true;
  }

  private async download(request: AigfsDataRequest, path: string): Promise<AigfsSourceFile> {
    const chunks: Uint8Array[] = [];

    if (request.variables.length > 0) {
      const ranges = await this.selectedRanges(request, "pres");
      chunks.push(await this.fetchCoveringRange(
        buildAigfsNomadsUrl(request.run, request.forecastHour, "pres"),
        coveringRange(ranges),
      ));
    }

    if (request.fields.length > 0) {
      const ranges = await this.selectedRanges(request, "sfc");
      chunks.push(await this.fetchCoveringRange(
        buildAigfsNomadsUrl(request.run, request.forecastHour, "sfc"),
        coveringRange(ranges),
      ));
    }

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

  private async selectedRanges(
    request: AigfsDataRequest,
    product: AigfsProduct,
  ): Promise<ByteRange[]> {
    const indexText = await this.fetchIndex(request.run, request.forecastHour, product);
    const records = parseGribIndex(indexText);
    return product === "pres"
      ? selectPressureByteRanges(
          records,
          request.variables.map((variable) => variable.gfsCode),
          request.pressureLevelsHpa,
        )
      : selectNonIsobaricByteRanges(records, request.fields);
  }

  private async fetchIndex(
    run: Date,
    forecastHour: number,
    product: AigfsProduct,
  ): Promise<string> {
    const url = buildAigfsNomadsIndexUrl(run, forecastHour, product);
    const path = this.indexPath(url);
    try {
      return await readFile(path, "utf8");
    } catch {
      // AIGFS products are immutable after publication.
    }

    await mkdir(this.rootDir, { recursive: true });
    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": WFG_USER_AGENT } },
      { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
    );
    if (!response.ok) {
      throw new Error(
        `AIGFS NOMADS index request failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    const text = await response.text();
    await writeFile(path, text, "utf8");
    return text;
  }

  private async hasIndex(
    run: Date,
    forecastHour: number,
    product: AigfsProduct,
  ): Promise<boolean> {
    const url = buildAigfsNomadsIndexUrl(run, forecastHour, product);
    const path = this.indexPath(url);
    if (await exists(path)) return true;

    await mkdir(this.rootDir, { recursive: true });
    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": WFG_USER_AGENT } },
      { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
    );
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(
        `AIGFS NOMADS availability request failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    const text = await response.text();
    await writeFile(path, text, "utf8");
    return true;
  }

  private async fetchCoveringRange(url: string, range: ByteRange): Promise<Uint8Array> {
    const rangeValue = `bytes=${range.start}-${range.end ?? ""}`;
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          range: rangeValue,
          "user-agent": WFG_USER_AGENT,
        },
      },
      { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
    );
    if (response.status !== 206) {
      throw new Error(
        `AIGFS NOMADS range request failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
      throw new Error(`AIGFS NOMADS range did not start with a GRIB message (${rangeValue})`);
    }
    return bytes;
  }

  private indexPath(url: string): string {
    return join(this.rootDir, `${createHash("sha256").update(url).digest("hex")}.idx`);
  }
}

function subsetKey(request: AigfsDataRequest): string {
  const canonical = JSON.stringify({
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    variables: [...new Set(request.variables.map((variable) => variable.gfsCode))].sort(),
    pressureLevelsHpa: [...new Set(request.pressureLevelsHpa)].sort((a, b) => b - a),
    fields: [...new Set(request.fields.map((field) => field.id))].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function coveringRange(ranges: ByteRange[]): ByteRange {
  if (ranges.length === 0) throw new Error("AIGFS index selection returned no byte ranges");
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  return last.end === undefined
    ? { start: first.start }
    : { start: first.start, end: last.end };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
