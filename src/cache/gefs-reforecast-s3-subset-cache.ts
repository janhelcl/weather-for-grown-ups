import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "./file-access-policy.js";
import type { RawGefsFieldDefinition } from "../catalog/gefs-fields.js";
import type { RawVariableDefinition } from "../catalog/variables.js";
import {
  parseGribIndex,
  selectNonIsobaricByteRangesAtForecastHour,
  selectPressureByteRangesAtForecastHour,
  type ByteRange,
} from "../grib/index.js";
import {
  DEFAULT_HTTP_RETRY_MAX_ATTEMPTS,
  isRetryableHttpStatus,
  waitBeforeHttpRetry,
} from "../sources/http-retry.js";
import {
  isGefsReforecastFieldId,
  isSupportedGefsReforecastPressureSelection,
  type GefsReforecastFieldId,
  type GefsReforecastMember,
  type GefsReforecastPressureVariableId,
} from "../catalog/gefs-reforecast.js";
import {
  buildGefsReforecastFieldIndexUrl,
  buildGefsReforecastFieldUrl,
  buildGefsReforecastPressureIndexUrl,
  buildGefsReforecastPressureUrl,
  gefsReforecastPressureFileGroup,
  type GefsReforecastPressureFileGroup,
} from "../sources/gefs-reforecast-s3.js";

type RawReforecastFieldId = Exclude<GefsReforecastFieldId, "wind_10m">;

export interface GefsReforecastSelectionDataRequest {
  run: Date;
  forecastHour: number;
  member: GefsReforecastMember;
  fields?: RawGefsFieldDefinition[];
  pressureVariables?: RawVariableDefinition[];
  pressureLevelsHpa?: number[];
}

type NormalizedReforecastSelectionDataRequest = GefsReforecastSelectionDataRequest & {
  fields: RawGefsFieldDefinition[];
  pressureVariables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
};

export interface GefsReforecastSubsetFile {
  path: string;
  cacheHit: boolean;
}

export interface GefsReforecastSelectionSource {
  fetchSelection(request: GefsReforecastSelectionDataRequest): Promise<GefsReforecastSubsetFile>;
}

export class GefsReforecastS3SubsetCache implements GefsReforecastSelectionSource {
  private readonly inFlight = new Map<string, Promise<GefsReforecastSubsetFile>>();

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly accessPolicy: UpstreamAccessPolicy = new FileAccessPolicy(
      join(rootDir, "access-state"),
      UPSTREAM_ACCESS_POLICIES.noaaAws,
    ),
  ) {}

  async fetchSelection(request: GefsReforecastSelectionDataRequest): Promise<GefsReforecastSubsetFile> {
    const normalized: NormalizedReforecastSelectionDataRequest = {
      ...request,
      fields: canonicalFields(request.fields ?? []),
      pressureVariables: canonicalPressureVariables(request.pressureVariables ?? []),
      pressureLevelsHpa: [...new Set(request.pressureLevelsHpa ?? [])].sort((a, b) => a - b),
    };
    if (normalized.fields.length === 0 && normalized.pressureVariables.length === 0) {
      throw new Error("GEFSv12 reforecast selection must request fields or pressure variables");
    }
    if (normalized.pressureVariables.length > 0 && normalized.pressureLevelsHpa.length === 0) {
      throw new Error("GEFSv12 reforecast pressure variables require pressure levels");
    }

    const key = selectionKey(normalized);
    await mkdir(this.rootDir, { recursive: true });
    const path = join(this.rootDir, `${key}.grib2`);
    if (await exists(path)) return { path, cacheHit: true };
    const pending = this.inFlight.get(key);
    if (pending) {
      const result = await pending;
      return { ...result, cacheHit: true };
    }
    const operation = this.download(normalized, path).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  private async download(
    request: NormalizedReforecastSelectionDataRequest,
    path: string,
  ): Promise<GefsReforecastSubsetFile> {
    const chunks: Uint8Array[] = [];

    for (const field of request.fields) {
      if (!isGefsReforecastFieldId(field.id)) {
        throw new Error(`GEFSv12 reforecast does not expose field ${field.id} in the current WFG source contract`);
      }
      const fieldId = field.id as RawReforecastFieldId;
      const gribUrl = buildGefsReforecastFieldUrl(request.run, request.member, request.forecastHour, fieldId);
      const indexUrl = buildGefsReforecastFieldIndexUrl(request.run, request.member, request.forecastHour, fieldId);
      const records = parseGribIndex(await this.fetchIndex(indexUrl));
      const ranges = selectNonIsobaricByteRangesAtForecastHour(records, [field], request.forecastHour);
      if (ranges.length !== 1) {
        throw new Error(`GEFSv12 reforecast field ${field.id} selected ${ranges.length} GRIB messages; expected exactly one`);
      }
      chunks.push(await this.fetchRange(gribUrl, ranges[0]!));
    }

    for (const variable of request.pressureVariables) {
      const variableId = variable.id as GefsReforecastPressureVariableId;
      const levelsByFileGroup = new Map<GefsReforecastPressureFileGroup, number[]>();
      for (const pressureLevelHpa of request.pressureLevelsHpa) {
        if (!isSupportedGefsReforecastPressureSelection(variableId, pressureLevelHpa)) {
          throw new Error(`GEFSv12 reforecast does not expose ${variable.id} at ${pressureLevelHpa} hPa`);
        }
        const group = gefsReforecastPressureFileGroup(request.forecastHour, pressureLevelHpa);
        const levels = levelsByFileGroup.get(group) ?? [];
        levels.push(pressureLevelHpa);
        levelsByFileGroup.set(group, levels);
      }

      for (const [fileGroup, pressureLevelsHpa] of levelsByFileGroup) {
        const gribUrl = buildGefsReforecastPressureUrl(
          request.run,
          request.member,
          request.forecastHour,
          variableId,
          fileGroup,
        );
        const indexUrl = buildGefsReforecastPressureIndexUrl(
          request.run,
          request.member,
          request.forecastHour,
          variableId,
          fileGroup,
        );
        const records = parseGribIndex(await this.fetchIndex(indexUrl));
        const ranges = selectPressureByteRangesAtForecastHour(
          records,
          [variable.gfsCode],
          pressureLevelsHpa,
          request.forecastHour,
        );
        for (const range of ranges) chunks.push(await this.fetchRange(gribUrl, range));
      }
    }

    if (chunks.length === 0) throw new Error("GEFSv12 reforecast selection selected no GRIB messages");
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
      try {
        await rename(tempPath, path);
      } catch (error) {
        if (await exists(path)) await rm(tempPath, { force: true });
        else throw error;
      }
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
      // Immutable reforecast inventories are cached permanently.
    }

    for (let attempt = 1; attempt <= DEFAULT_HTTP_RETRY_MAX_ATTEMPTS; attempt += 1) {
      const result = await this.accessPolicy.run(async () => {
        const response = await this.fetchFn(url, {
          headers: { "user-agent": "weather-for-grown-ups/0.2" },
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
        throw new Error(`NOAA GEFSv12 reforecast AWS index request failed: HTTP ${result.status} ${result.statusText}`);
      }
      await writeFile(path, result.text, "utf8");
      return result.text;
    }
    throw new Error("NOAA GEFSv12 reforecast AWS index retry loop exhausted unexpectedly");
  }

  private async fetchRange(url: string, range: ByteRange): Promise<Uint8Array> {
    const rangeValue = `bytes=${range.start}-${range.end ?? ""}`;
    for (let attempt = 1; attempt <= DEFAULT_HTTP_RETRY_MAX_ATTEMPTS; attempt += 1) {
      const result = await this.accessPolicy.run(async () => {
        const response = await this.fetchFn(url, {
          headers: {
            range: rangeValue,
            "user-agent": "weather-for-grown-ups/0.2",
          },
        });
        return {
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get("retry-after"),
          bytes: response.status === 206 ? new Uint8Array(await response.arrayBuffer()) : undefined,
        };
      });
      if (isRetryableHttpStatus(result.status) && attempt < DEFAULT_HTTP_RETRY_MAX_ATTEMPTS) {
        await waitBeforeHttpRetry(attempt, result.retryAfter);
        continue;
      }
      if (result.status !== 206 || result.bytes === undefined) {
        throw new Error(`NOAA GEFSv12 reforecast AWS range request failed: HTTP ${result.status} ${result.statusText}`);
      }
      if (
        result.bytes.length < 4
        || new TextDecoder().decode(result.bytes.slice(0, 4)) !== "GRIB"
      ) {
        throw new Error(`NOAA GEFSv12 reforecast AWS range did not start with a GRIB message (${rangeValue})`);
      }
      return result.bytes;
    }
    throw new Error("NOAA GEFSv12 reforecast AWS range retry loop exhausted unexpectedly");
  }
}

function selectionKey(request: NormalizedReforecastSelectionDataRequest): string {
  return createHash("sha256").update(JSON.stringify({
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    member: request.member,
    fields: request.fields.map((field) => ({
      id: field.id,
      gfsCode: field.gfsCode,
      gribLevel: field.level.gribLevel,
      temporalSemantics: field.temporalSemantics,
    })),
    pressureVariables: request.pressureVariables.map((variable) => ({
      id: variable.id,
      gfsCode: variable.gfsCode,
    })),
    pressureLevelsHpa: request.pressureLevelsHpa,
  })).digest("hex");
}

function canonicalFields(fields: RawGefsFieldDefinition[]): RawGefsFieldDefinition[] {
  return [...fields].sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalPressureVariables(variables: RawVariableDefinition[]): RawVariableDefinition[] {
  return [...variables].sort((left, right) => left.id.localeCompare(right.id));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
