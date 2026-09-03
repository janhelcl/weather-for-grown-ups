import { resolveMeteoFranceBearerToken } from "../access/meteo-france-auth.js";
import { WFG_USER_AGENT } from "../access/user-agent.js";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import type {
  AromeAvailabilityRequirement,
  AromeDataRequest,
  AromeSourceFile,
  AromeSubsetCache,
} from "./arome-open-data-cache.js";
import { expandPeAromeRequestedFields, type PeAromeMember } from "../catalog/pe-arome.js";
import {
  buildPeAromeGetCoverageUrl,
  peAromeValidTime,
  resolvePeAromeWcsEndpoint,
  type PeAromeSpatialSubset,
} from "../sources/pe-arome.js";

const DEFAULT_PROBE_SUBSET: PeAromeSpatialSubset = {
  westLongitude: 2.30,
  eastLongitude: 2.40,
  southLatitude: 48.80,
  northLatitude: 48.90,
};

const DEFAULT_DOMAIN_SUBSET: PeAromeSpatialSubset = {
  westLongitude: -12,
  eastLongitude: 16,
  southLatitude: 37.5,
  northLatitude: 55.4,
};

export interface PeAromeWcsCacheOptions {
  fetchFn?: typeof fetch;
  endpoint?: string;
  endpointProvider?: (member: PeAromeMember) => string;
  token?: string;
  tokenProvider?: () => string | Promise<string>;
  accessPolicy?: UpstreamAccessPolicy;
}

export class PeAromeWcsCache implements AromeSubsetCache {
  private readonly inFlight = new Map<string, Promise<AromeSourceFile>>();
  private readonly fetchFn: typeof fetch;
  private readonly endpointProvider: (member: PeAromeMember) => string;
  private readonly tokenProvider: () => string | Promise<string>;
  private readonly accessPolicy: UpstreamAccessPolicy;

  constructor(
    private readonly rootDir: string,
    private readonly member: PeAromeMember,
    options: PeAromeWcsCacheOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.endpointProvider = options.endpoint === undefined
      ? options.endpointProvider ?? ((candidate) => resolvePeAromeWcsEndpoint(candidate))
      : () => options.endpoint!;
    this.tokenProvider = options.token === undefined
      ? options.tokenProvider ?? (() => resolveMeteoFranceBearerToken())
      : () => options.token!;
    this.accessPolicy = options.accessPolicy ?? new FileAccessPolicy(
      join(dirname(rootDir), "access-state"),
      UPSTREAM_ACCESS_POLICIES.meteoFranceApi,
    );
  }

  async fetch(request: AromeDataRequest): Promise<AromeSourceFile> {
    if (request.fields.length === 0) {
      throw new Error("PE-AROME WCS request must contain at least one supported field");
    }
    await mkdir(this.rootDir, { recursive: true });
    const subset = request.subset ?? DEFAULT_DOMAIN_SUBSET;
    const key = subsetKey(this.member, request, subset);
    const path = join(this.rootDir, `${key}.grib2`);
    if (await exists(path)) return { path, cacheHit: true };

    const pending = this.inFlight.get(key);
    if (pending) {
      const result = await pending;
      return { ...result, cacheHit: true };
    }
    const operation = this.download(request, subset, path)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  async isForecastAvailable(
    run: Date,
    forecastHour: number,
    _requirement: AromeAvailabilityRequirement,
  ): Promise<boolean> {
    const field = expandPeAromeRequestedFields(["temperature_2m"])[0]!;
    const response = await this.requestCoverage(
      { run, forecastHour, field, subset: DEFAULT_PROBE_SUBSET },
      false,
    );
    if (response.status === 403 || response.status === 404) return false;
    if (response.status === 401) {
      throw new Error("Météo-France PE-AROME API rejected the bearer token (HTTP 401)");
    }
    if (!response.ok) {
      throw new Error(
        `Météo-France PE-AROME availability request failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    return true;
  }

  private async download(
    request: AromeDataRequest,
    subset: PeAromeSpatialSubset,
    path: string,
  ): Promise<AromeSourceFile> {
    const chunks = await Promise.all(request.fields.map(async (field) => {
      const response = await this.requestCoverage(
        { run: request.run, forecastHour: request.forecastHour, field, subset },
        true,
      );
      if (!response.ok) {
        throw new Error(
          `Météo-France PE-AROME WCS request failed: HTTP ${response.status} ${response.statusText}`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
        throw new Error("Météo-France PE-AROME WCS response did not start with GRIB");
      }
      return bytes;
    }));

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

  private async requestCoverage(
    request: Parameters<typeof buildPeAromeGetCoverageUrl>[1],
    acceptBinary: boolean,
  ): Promise<Response> {
    const endpoint = this.endpointProvider(this.member);
    const token = await this.tokenProvider();
    const url = buildPeAromeGetCoverageUrl(endpoint, request);
    return fetchWithRetry(
      url,
      {
        headers: {
          accept: acceptBinary ? "application/octet-stream" : "*/*",
          authorization: `Bearer ${token}`,
          "user-agent": WFG_USER_AGENT,
        },
      },
      { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
    );
  }
}

function subsetKey(
  member: PeAromeMember,
  request: AromeDataRequest,
  subset: PeAromeSpatialSubset,
): string {
  return createHash("sha256").update(JSON.stringify({
    model: "pe-arome-0p025",
    member,
    run: request.run.toISOString(),
    validTime: peAromeValidTime(request.run, request.forecastHour).toISOString(),
    fields: [...new Set(request.fields.map((field) => field.id))].sort(),
    subset,
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
