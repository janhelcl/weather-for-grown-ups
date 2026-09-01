import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import {
  buildArome0p01OpenDataUrl,
  type Arome0p01Package,
} from "../sources/arome.js";

export interface AromeDataRequest {
  run: Date;
  forecastHour: number;
  fields: RawNonIsobaricFieldDefinition[];
  /**
   * Optional geographic subset for sources that can subset server-side.
   * The anonymous AROME package source intentionally ignores this because
   * its files are already packaged by run/lead rather than request geometry.
   */
  subset?: {
    westLongitude: number;
    eastLongitude: number;
    southLatitude: number;
    northLatitude: number;
  };
}

export interface AromeSourceFile {
  path: string;
  cacheHit: boolean;
}

export interface AromeAvailabilityRequirement {
  sp1: boolean;
  hp1: boolean;
}

export interface AromeAvailabilityProbe {
  isForecastAvailable(
    run: Date,
    forecastHour: number,
    requirement: AromeAvailabilityRequirement,
  ): Promise<boolean>;
}

export interface AromeSubsetCache extends AromeAvailabilityProbe {
  fetch(request: AromeDataRequest): Promise<AromeSourceFile>;
}

export class AromeOpenDataCache implements AromeSubsetCache {
  private readonly inFlight = new Map<string, Promise<AromeSourceFile>>();

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly accessPolicy: UpstreamAccessPolicy = new FileAccessPolicy(
      join(rootDir, "access-state"),
      UPSTREAM_ACCESS_POLICIES.meteoFranceOpenData,
    ),
  ) {}

  async fetch(request: AromeDataRequest): Promise<AromeSourceFile> {
    if (request.fields.length === 0) {
      throw new Error("AROME subset request must contain at least one supported field");
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
    requirement: AromeAvailabilityRequirement,
  ): Promise<boolean> {
    const packages: Arome0p01Package[] = [
      ...(requirement.sp1 ? ["SP1" as const] : []),
      ...(requirement.hp1 ? ["HP1" as const] : []),
    ];
    if (packages.length === 0) return false;

    for (const packageId of packages) {
      const url = buildArome0p01OpenDataUrl(run, forecastHour, packageId);
      const response = await fetchWithRetry(
        url,
        {
          method: "HEAD",
          headers: { "user-agent": "weather-for-grown-ups/0.4" },
        },
        { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
      );
      if (response.status === 404) return false;
      if (!response.ok) {
        throw new Error(
          `Météo-France AROME availability request failed: HTTP ${response.status} ${response.statusText} for ${url}`,
        );
      }
    }
    return true;
  }

  private async download(request: AromeDataRequest, path: string): Promise<AromeSourceFile> {
    const packages = selectedPackages(request.fields);
    const chunks = await Promise.all(packages.map((packageId) =>
      this.fetchPackage(request.run, request.forecastHour, packageId)));

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

  private async fetchPackage(
    run: Date,
    forecastHour: number,
    packageId: Arome0p01Package,
  ): Promise<Uint8Array> {
    const url = buildArome0p01OpenDataUrl(run, forecastHour, packageId);
    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": "weather-for-grown-ups/0.4" } },
      { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
    );
    if (!response.ok) {
      throw new Error(
        `Météo-France AROME Open Data request failed: HTTP ${response.status} ${response.statusText} for ${url}`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
      throw new Error(`Météo-France AROME object did not start with GRIB: ${url}`);
    }
    return bytes;
  }
}

export function aromePackagesForFields(
  fields: readonly RawNonIsobaricFieldDefinition[],
): AromeAvailabilityRequirement {
  const packages = new Set(selectedPackages(fields));
  return {
    sp1: packages.has("SP1"),
    hp1: packages.has("HP1"),
  };
}

function selectedPackages(
  fields: readonly RawNonIsobaricFieldDefinition[],
): Arome0p01Package[] {
  return [...new Set(fields.map(fieldPackage))].sort();
}

function fieldPackage(field: RawNonIsobaricFieldDefinition): Arome0p01Package {
  switch (field.id) {
    case "temperature_2m":
    case "relative_humidity_2m":
    case "u_wind_10m":
    case "v_wind_10m":
      return "SP1";
    case "u_wind_20m":
    case "v_wind_20m":
    case "u_wind_50m":
    case "v_wind_50m":
    case "u_wind_100m":
    case "v_wind_100m":
      return "HP1";
    default:
      throw new Error(
        `AROME 0.01° Open Data has no package mapping for field=${field.id}`,
      );
  }
}

function subsetKey(request: AromeDataRequest): string {
  return createHash("sha256").update(JSON.stringify({
    model: "arome-0p01",
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    fields: [...new Set(request.fields.map((field) => field.id))].sort(),
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
