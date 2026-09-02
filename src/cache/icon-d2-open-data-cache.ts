import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Bunzip from "seek-bzip";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import type { RawVariableDefinition } from "../catalog/variables.js";
import { buildIconD2OpenDataUrl } from "../sources/icon-d2.js";

export interface IconD2DataRequest {
  run: Date;
  forecastHour: number;
  variables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
  fields: RawNonIsobaricFieldDefinition[];
}

export interface IconD2SourceFile {
  path: string;
  cacheHit: boolean;
}

export interface IconD2AvailabilityRequirement {
  pressure: boolean;
  surface: boolean;
}

export interface IconD2AvailabilityProbe {
  isForecastAvailable(
    run: Date,
    forecastHour: number,
    requirement: IconD2AvailabilityRequirement,
  ): Promise<boolean>;
}

export interface IconD2SubsetCache extends IconD2AvailabilityProbe {
  fetch(request: IconD2DataRequest): Promise<IconD2SourceFile>;
}

export type IconD2Bzip2Decoder = (bytes: Uint8Array) => Promise<Uint8Array>;

export class IconD2OpenDataCache implements IconD2SubsetCache {
  private readonly inFlight = new Map<string, Promise<IconD2SourceFile>>();

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly accessPolicy: UpstreamAccessPolicy = new FileAccessPolicy(
      join(rootDir, "access-state"),
      UPSTREAM_ACCESS_POLICIES.dwdOpenData,
    ),
    private readonly decompress: IconD2Bzip2Decoder = bunzip2,
  ) {}

  async fetch(request: IconD2DataRequest): Promise<IconD2SourceFile> {
    if (request.variables.length === 0 && request.fields.length === 0) {
      throw new Error(
        "ICON-D2 subset request must contain at least one pressure variable or surface field",
      );
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
    requirement: IconD2AvailabilityRequirement,
  ): Promise<boolean> {
    if (!requirement.pressure && !requirement.surface) return false;
    const urls: string[] = [];
    if (requirement.pressure) {
      urls.push(buildIconD2OpenDataUrl(run, forecastHour, {
        type: "pressure",
        parameter: "t",
        pressureHpa: 850,
      }));
    }
    if (requirement.surface) {
      urls.push(buildIconD2OpenDataUrl(run, forecastHour, {
        type: "single",
        parameter: "t_2m",
      }));
    }
    for (const url of urls) {
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
          `DWD ICON-D2 availability request failed: HTTP ${response.status} ${response.statusText} for ${url}`,
        );
      }
    }
    return true;
  }

  private async download(
    request: IconD2DataRequest,
    path: string,
  ): Promise<IconD2SourceFile> {
    const urls = selectedUrls(request);
    const chunks = await Promise.all(urls.map((url) => this.fetchAndDecompress(url)));
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

  private async fetchAndDecompress(url: string): Promise<Uint8Array> {
    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": "weather-for-grown-ups/0.4" } },
      { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
    );
    if (!response.ok) {
      throw new Error(
        `DWD ICON-D2 Open Data request failed: HTTP ${response.status} ${response.statusText} for ${url}`,
      );
    }
    const bytes = await this.decompress(new Uint8Array(await response.arrayBuffer()));
    if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
      throw new Error(`DWD ICON-D2 decompressed object did not start with GRIB: ${url}`);
    }
    return bytes;
  }
}

function selectedUrls(request: IconD2DataRequest): string[] {
  const urls: string[] = [];

  for (const variable of request.variables) {
    const parameter = pressureParameter(variable);
    for (const pressureHpa of request.pressureLevelsHpa) {
      urls.push(buildIconD2OpenDataUrl(request.run, request.forecastHour, {
        type: "pressure",
        parameter,
        pressureHpa,
      }));
    }
  }

  for (const field of request.fields) {
    urls.push(buildIconD2OpenDataUrl(request.run, request.forecastHour, {
      type: "single",
      parameter: fieldParameter(field),
    }));
  }

  return [...new Set(urls)];
}

function pressureParameter(variable: RawVariableDefinition): string {
  switch (variable.id) {
    case "temperature": return "t";
    case "relative_humidity": return "relhum";
    case "u_wind": return "u";
    case "v_wind": return "v";
    case "geopotential_height": return "fi";
    case "vertical_velocity": return "omega";
    default:
      throw new Error(
        `ICON-D2 Open Data has no pressure-file mapping for variable=${variable.id}`,
      );
  }
}

function fieldParameter(field: RawNonIsobaricFieldDefinition): string {
  switch (field.id) {
    case "temperature_2m": return "t_2m";
    case "u_wind_10m": return "u_10m";
    case "v_wind_10m": return "v_10m";
    case "wind_gust": return "vmax_10m";
    case "mean_layer_cape": return "cape_ml";
    case "mean_layer_cin": return "cin_ml";
    case "mean_sea_level_pressure": return "pmsl";
    case "total_precipitation": return "tot_prec";
    case "convective_rain": return "rain_con";
    case "convective_snow": return "snow_con";
    case "visibility": return "vis";
    case "cloud_ceiling_height_msl": return "ceiling";
    case "shallow_convective_cloud_base_height_msl": return "hbas_sc";
    case "shallow_convective_cloud_top_height_msl": return "htop_sc";
    case "dry_convection_top_height_msl": return "htop_dc";
    case "column_maximum_reflectivity": return "dbz_cmax";
    default:
      throw new Error(
        `ICON-D2 Open Data has no single-level file mapping for field=${field.id}`,
      );
  }
}

function subsetKey(request: IconD2DataRequest): string {
  return createHash("sha256").update(JSON.stringify({
    model: "icon-d2",
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    variables: [...new Set(request.variables.map((variable) => variable.id))].sort(),
    pressureLevelsHpa: [...new Set(request.pressureLevelsHpa)].sort((a, b) => b - a),
    fields: [...new Set(request.fields.map((field) => field.id))].sort(),
  })).digest("hex");
}

export async function bunzip2(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(Bunzip.decode(bytes));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
