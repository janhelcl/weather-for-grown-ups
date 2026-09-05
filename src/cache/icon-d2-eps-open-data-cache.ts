import { upstreamHttpFailure } from "../access/http-failure.js";
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
import {
  iconD2EpsMemberOrdinal,
  type IconD2EpsMember,
} from "../catalog/icon-d2-eps.js";
import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import type { RawVariableDefinition } from "../catalog/variables.js";
import { buildIconD2EpsOpenDataUrl } from "../sources/icon-d2-eps.js";
import { scanGrib2Messages } from "../grib/dwd-local-parameters.js";
import {
  bunzip2,
  type IconD2AvailabilityRequirement,
  type IconD2Bzip2Decoder,
  type IconD2DataRequest,
  type IconD2SourceFile,
  type IconD2SubsetCache,
} from "./icon-d2-open-data-cache.js";

const ICON_D2_EPS_MEMBER_COUNT = 20;
/**
 * Product definition templates 4.1 (instant) and 4.11 (statistical interval)
 * are the individual-ensemble-member templates DWD publishes for ICON-D2-EPS.
 * Both place the perturbation number at section-4 octet 36.
 */
const ENSEMBLE_MEMBER_PRODUCT_TEMPLATES = new Set([1, 11]);
const PERTURBATION_NUMBER_OFFSET = 35;

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
          headers: { "user-agent": WFG_USER_AGENT },
        },
        { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
      );
      if (response.status === 404) return false;
      if (!response.ok) {
        throw upstreamHttpFailure({
          provider: "DWD Open Data",
          operation: "ICON-D2-EPS availability request",
          status: response.status,
          statusText: response.statusText,
          url,
        });
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
      { headers: { "user-agent": WFG_USER_AGENT } },
      { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
    );
    if (!response.ok) {
      throw upstreamHttpFailure({
        provider: "DWD Open Data",
        operation: "ICON-D2-EPS product request",
        status: response.status,
        statusText: response.statusText,
        resource: "the requested ICON-D2-EPS product file",
        url,
      });
    }
    const bytes = await this.decompress(new Uint8Array(await response.arrayBuffer()));
    if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
      throw new Error(`DWD ICON-D2-EPS decompressed object did not start with GRIB: ${url}`);
    }
    return bytes;
  }
}

/**
 * DWD packages all ICON-D2-EPS members in one GRIB object. This shared filter
 * reads each message's product definition section, resolves the provider's
 * perturbation numbers once, and materializes immutable member-only GRIB files
 * for the existing deterministic ICON-D2 engine. Messages are copied verbatim.
 */
export class IconD2EpsMemberFileFilter {
  private readonly inFlight = new Map<string, Promise<IconD2SourceFile>>();

  constructor(private readonly rootDir: string) {}

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
    const bytes = new Uint8Array(await readFile(sourcePath));
    const selected = selectIconD2EpsMemberMessages(bytes, member);
    const tempPath = `${memberPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, selected);
      await rename(tempPath, memberPath);
      return { path: memberPath, cacheHit: false };
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }
}

/**
 * Return the concatenated GRIB2 messages of one member. Members are resolved
 * by sorting the distinct perturbation numbers found in the object and
 * selecting the ordinal position of the requested member, which mirrors DWD's
 * `p01..p20` labelling without assuming a particular numbering origin.
 */
export function selectIconD2EpsMemberMessages(
  bytes: Uint8Array,
  member: IconD2EpsMember,
): Uint8Array {
  const slices = scanGrib2Messages(bytes);
  if (slices.length === 0) {
    throw new Error("ICON-D2-EPS all-members object contains no GRIB2 messages");
  }
  const perturbations = slices.map((slice) =>
    iconD2EpsPerturbationNumber(bytes.subarray(slice.start, slice.end)));
  const distinct = [...new Set(perturbations)].sort((left, right) => left - right);
  if (distinct.length !== ICON_D2_EPS_MEMBER_COUNT) {
    throw new Error(
      `ICON-D2-EPS object exposed ${distinct.length} distinct forecast-member numbers; expected ${ICON_D2_EPS_MEMBER_COUNT}`,
    );
  }
  const wanted = distinct[iconD2EpsMemberOrdinal(member) - 1];
  if (wanted === undefined) {
    throw new Error(`ICON-D2-EPS object has no member mapping for ${member}`);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let index = 0; index < slices.length; index += 1) {
    if (perturbations[index] !== wanted) continue;
    const slice = slices[index]!;
    chunks.push(bytes.subarray(slice.start, slice.end));
    total += slice.end - slice.start;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * Read the perturbation number of one GRIB2 message from its product
 * definition section. Only the individual-ensemble templates are accepted so a
 * deterministic or derived-ensemble message cannot be silently mislabelled.
 */
export function iconD2EpsPerturbationNumber(message: Uint8Array): number {
  let cursor = 16;
  const end = message.byteLength - 4;
  while (cursor + 5 <= end) {
    const length = readUint32(message, cursor);
    if (length < 5 || cursor + length > end) break;
    if (message[cursor + 4] === 4) {
      if (length < PERTURBATION_NUMBER_OFFSET + 2) {
        throw new Error("ICON-D2-EPS message has a product definition section without ensemble metadata");
      }
      const template = (message[cursor + 7]! << 8) | message[cursor + 8]!;
      if (!ENSEMBLE_MEMBER_PRODUCT_TEMPLATES.has(template)) {
        throw new Error(
          `ICON-D2-EPS message uses product definition template 4.${template}, which carries no individual member number`,
        );
      }
      return message[cursor + PERTURBATION_NUMBER_OFFSET]!;
    }
    cursor += length;
  }
  throw new Error("ICON-D2-EPS message is missing its product definition section");
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000
    + bytes[offset + 1]! * 0x10000
    + bytes[offset + 2]! * 0x100
    + bytes[offset + 3]!
  );
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
    case "mean_layer_cape": return "cape_ml";
    case "mean_layer_cin": return "cin_ml";
    case "updraft_helicity_max_2_8km": return "uh_max";
    case "mean_sea_level_pressure": return "pmsl";
    case "total_precipitation": return "tot_prec";
    case "convective_rain": return "rain_con";
    case "convective_snow": return "snow_con";
    case "visibility": return "vis";
    case "cloud_ceiling_height_msl": return "ceiling";
    case "shallow_convective_cloud_base_height_msl": return "hbas_sc";
    case "shallow_convective_cloud_top_height_msl": return "htop_sc";
    case "column_maximum_reflectivity": return "dbz_cmax";
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
