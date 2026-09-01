import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import {
  iconD2EpsMemberOrdinal,
  type IconD2EpsMember,
} from "../catalog/icon-d2-eps.js";
import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import type { RawVariableDefinition } from "../catalog/variables.js";
import { buildIconD2EpsOpenDataUrl } from "../sources/icon-d2-eps.js";
import {
  bunzip2,
  type IconD2AvailabilityRequirement,
  type IconD2Bzip2Decoder,
  type IconD2DataRequest,
  type IconD2SourceFile,
  type IconD2SubsetCache,
} from "./icon-d2-open-data-cache.js";

export type IconD2EpsWgrib2Runner = (
  executable: string,
  args: string[],
) => Promise<{ stdout: string }>;

const defaultWgrib2Runner: IconD2EpsWgrib2Runner = async (executable, args) => {
  const { stdout } = await execa(executable, args);
  return { stdout };
};

export class IconD2EpsOpenDataCache implements IconD2SubsetCache {
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
        "ICON-D2-EPS subset request must contain at least one pressure variable or surface field",
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
      urls.push(buildIconD2EpsOpenDataUrl(run, forecastHour, {
        type: "pressure",
        parameter: "t",
        pressureHpa: 850,
      }));
    }
    if (requirement.surface) {
      urls.push(buildIconD2EpsOpenDataUrl(run, forecastHour, {
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
          `DWD ICON-D2-EPS availability request failed: HTTP ${response.status} ${response.statusText} for ${url}`,
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
        `DWD ICON-D2-EPS Open Data request failed: HTTP ${response.status} ${response.statusText} for ${url}`,
      );
    }
    const bytes = await this.decompress(new Uint8Array(await response.arrayBuffer()));
    if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
      throw new Error(`DWD ICON-D2-EPS decompressed object did not start with GRIB: ${url}`);
    }
    return bytes;
  }
}

/**
 * DWD packages all ICON-D2-EPS members in one native-grid GRIB object.
 * This shared filter resolves the upstream ensemble labels once and materializes
 * immutable member-only GRIB files for the existing deterministic ICON-D2 engine.
 *
 * Native wgrib2 is intentionally required here: the bundled decoder cannot read
 * the provider-native triangular ICON-D2-EPS files reliably.
 */
export class IconD2EpsMemberFileFilter {
  private readonly inventories = new Map<string, Promise<string>>();
  private readonly inFlight = new Map<string, Promise<IconD2SourceFile>>();

  constructor(
    private readonly rootDir: string,
    private readonly executable = process.env.WGRIB2_PATH ?? "wgrib2",
    private readonly runner: IconD2EpsWgrib2Runner = defaultWgrib2Runner,
  ) {}

  async filter(path: string, member: IconD2EpsMember): Promise<IconD2SourceFile> {
    await mkdir(this.rootDir, { recursive: true });
    const key = createHash("sha256").update(`${path}\0${member}`).digest("hex");
    const memberPath = join(this.rootDir, `${key}.grib2`);
    if (await exists(memberPath)) return { path: memberPath, cacheHit: true };

    const pending = this.inFlight.get(key);
    if (pending) {
      const result = await pending;
      return { ...result, cacheHit: true };
    }

    const operation = this.materialize(path, member, memberPath)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  private async materialize(
    sourcePath: string,
    member: IconD2EpsMember,
    memberPath: string,
  ): Promise<IconD2SourceFile> {
    const inventory = await this.inventory(sourcePath);
    const ensembleTag = iconD2EpsWgrib2TagForMember(inventory, member);
    const tempPath = `${memberPath}.${process.pid}.${randomUUID()}.tmp`;

    try {
      const { stdout } = await this.run([
        sourcePath,
        "-match_fs",
        `:${ensembleTag}`,
        "-grib",
        tempPath,
      ]);
      const details = await stat(tempPath);
      if (details.size === 0) {
        throw new Error(
          `wgrib2 produced an empty ICON-D2-EPS member file for ${member}. Output: ${stdout.slice(0, 500)}`,
        );
      }
      await rename(tempPath, memberPath);
      return { path: memberPath, cacheHit: false };
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }

  private inventory(path: string): Promise<string> {
    const cached = this.inventories.get(path);
    if (cached !== undefined) return cached;
    const pending = this.run([path, "-s"]).then(({ stdout }) => stdout);
    this.inventories.set(path, pending);
    void pending.catch(() => this.inventories.delete(path));
    return pending;
  }

  private async run(args: string[]): Promise<{ stdout: string }> {
    try {
      return await this.runner(this.executable, args);
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error(
          "ICON-D2-EPS requires native wgrib2 for DWD's provider-native triangular GRIB files. "
          + `Install wgrib2 or set WGRIB2_PATH. Original error: ${error.message}`,
        );
      }
      throw error;
    }
  }
}

export class IconD2EpsMemberSubsetCache implements IconD2SubsetCache {
  constructor(
    private readonly source: IconD2SubsetCache,
    private readonly member: IconD2EpsMember,
    private readonly filter: IconD2EpsMemberFileFilter,
  ) {}

  async fetch(request: IconD2DataRequest): Promise<IconD2SourceFile> {
    const sourceFile = await this.source.fetch(request);
    const memberFile = await this.filter.filter(sourceFile.path, this.member);
    return {
      path: memberFile.path,
      cacheHit: sourceFile.cacheHit && memberFile.cacheHit,
    };
  }

  isForecastAvailable(
    run: Date,
    forecastHour: number,
    requirement: IconD2AvailabilityRequirement,
  ): Promise<boolean> {
    return this.source.isForecastAvailable(run, forecastHour, requirement);
  }
}

export function iconD2EpsWgrib2TagForMember(
  inventory: string,
  member: IconD2EpsMember,
): string {
  const tags = [...new Set(
    inventory
      .split(/\r?\n/)
      .flatMap((line) => [...line.matchAll(/:((?:ENS|P-ENS|IC-ENS|MP-ENS|ICMP-ENS)=[^:]+)/g)])
      .map((match) => match[1])
      .filter((tag): tag is string => tag !== undefined),
  )]
    .map((tag) => ({ tag, order: ensembleTagOrder(tag) }))
    .filter((entry): entry is { tag: string; order: number } => entry.order !== null)
    .sort((left, right) => left.order - right.order);

  if (tags.length !== 20) {
    throw new Error(
      `ICON-D2-EPS wgrib2 inventory exposed ${tags.length} distinct forecast-member tags; expected 20`,
    );
  }

  const selected = tags[iconD2EpsMemberOrdinal(member) - 1];
  if (selected === undefined) {
    throw new Error(`ICON-D2-EPS inventory has no member mapping for ${member}`);
  }
  return selected.tag;
}

function ensembleTagOrder(tag: string): number | null {
  const match = tag.match(/=(?:\+|-)?(\d+)$/);
  if (match?.[1] === undefined) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function selectedUrls(request: IconD2DataRequest): string[] {
  const urls: string[] = [];

  for (const variable of request.variables) {
    const parameter = pressureParameter(variable);
    for (const pressureHpa of request.pressureLevelsHpa) {
      urls.push(buildIconD2EpsOpenDataUrl(request.run, request.forecastHour, {
        type: "pressure",
        parameter,
        pressureHpa,
      }));
    }
  }

  for (const field of request.fields) {
    urls.push(buildIconD2EpsOpenDataUrl(request.run, request.forecastHour, {
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
        `ICON-D2-EPS Open Data has no pressure-file mapping for variable=${variable.id}`,
      );
  }
}

function fieldParameter(field: RawNonIsobaricFieldDefinition): string {
  switch (field.id) {
    case "temperature_2m": return "t_2m";
    case "u_wind_10m": return "u_10m";
    case "v_wind_10m": return "v_10m";
    case "wind_gust": return "vmax_10m";
    case "mean_sea_level_pressure": return "pmsl";
    case "total_precipitation": return "tot_prec";
    default:
      throw new Error(
        `ICON-D2-EPS Open Data has no single-level file mapping for field=${field.id}`,
      );
  }
}

function subsetKey(request: IconD2DataRequest): string {
  return createHash("sha256").update(JSON.stringify({
    model: "icon-d2-eps",
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    variables: [...new Set(request.variables.map((variable) => variable.id))].sort(),
    pressureLevelsHpa: [...new Set(request.pressureLevelsHpa)].sort((a, b) => b - a),
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
