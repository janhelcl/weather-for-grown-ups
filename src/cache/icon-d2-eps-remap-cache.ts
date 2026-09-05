import { upstreamHttpFailure } from "../access/http-failure.js";
import { WFG_USER_AGENT } from "../access/user-agent.js";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import {
  parseCdoLonLatGridDescription,
  readScripNearestNeighbourIndex,
  remapGrib2Messages,
  type NearestNeighbourRemapIndex,
} from "../grib/icon-d2-remap.js";
import {
  bunzip2,
  type IconD2AvailabilityRequirement,
  type IconD2Bzip2Decoder,
  type IconD2DataRequest,
  type IconD2SourceFile,
  type IconD2SubsetCache,
} from "./icon-d2-open-data-cache.js";

const DWD_ICON_D2_REMAP_BUNDLE_URL =
  "https://opendata.dwd.de/weather/lib/cdo/ICON_D2_002_EASY.tar.bz2";
const TARGET_GRID_NAME = "target_grid_icon_d2_002.txt";
const WEIGHTS_NAME = "weights_icon_d2_002.nc";

export interface IconD2EpsRemapAssets {
  targetGridPath: string;
  weightsPath: string;
}

export interface IconD2EpsRemapAssetProvider {
  paths(): Promise<IconD2EpsRemapAssets>;
}

export interface IconD2EpsRemapIndexProvider {
  index(): Promise<NearestNeighbourRemapIndex>;
}

/**
 * DWD distributes the official ICON-D2 0.02 degree target grid and
 * nearest-neighbour remapping weights as a small tar bundle. Keep that
 * provider artifact separate from forecast objects: it is immutable support
 * data shared by every ICON-D2-EPS request.
 */
export class IconD2EpsDwdRemapAssetCache implements IconD2EpsRemapAssetProvider {
  private ready: Promise<IconD2EpsRemapAssets> | undefined;

  constructor(
    private readonly rootDir: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly accessPolicy: UpstreamAccessPolicy = new FileAccessPolicy(
      join(rootDir, "access-state"),
      UPSTREAM_ACCESS_POLICIES.dwdOpenData,
    ),
    private readonly decompress: IconD2Bzip2Decoder = bunzip2,
  ) {}

  paths(): Promise<IconD2EpsRemapAssets> {
    this.ready ??= this.ensureAssets().catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  private async ensureAssets(): Promise<IconD2EpsRemapAssets> {
    await mkdir(this.rootDir, { recursive: true });
    const targetGridPath = join(this.rootDir, TARGET_GRID_NAME);
    const weightsPath = join(this.rootDir, WEIGHTS_NAME);
    if (await exists(targetGridPath) && await exists(weightsPath)) {
      return { targetGridPath, weightsPath };
    }

    const response = await fetchWithRetry(
      DWD_ICON_D2_REMAP_BUNDLE_URL,
      { headers: { "user-agent": WFG_USER_AGENT } },
      { fetchFn: this.fetchFn, accessPolicy: this.accessPolicy },
    );
    if (!response.ok) {
      throw upstreamHttpFailure({
        provider: "DWD Open Data",
        operation: "ICON-D2 remapping-asset request",
        status: response.status,
        statusText: response.statusText,
      });
    }

    const downloaded = new Uint8Array(await response.arrayBuffer());
    const tarBytes = isBzip2(downloaded)
      ? await this.decompress(downloaded)
      : downloaded;
    const files = extractSelectedTarFiles(
      tarBytes,
      new Set([TARGET_GRID_NAME, WEIGHTS_NAME]),
    );
    const target = files.get(TARGET_GRID_NAME);
    const weights = files.get(WEIGHTS_NAME);
    if (target === undefined || weights === undefined) {
      throw new Error(
        "DWD ICON-D2 remapping bundle did not contain the expected target grid and weights",
      );
    }

    await Promise.all([
      atomicWrite(targetGridPath, target),
      atomicWrite(weightsPath, weights),
    ]);
    return { targetGridPath, weightsPath };
  }
}

/**
 * Parse DWD's target grid and SCRIP nearest-neighbour weights once per process
 * into the gather index used by the JS remapper. The 50 MB weights file is
 * read lazily on first use and the parsed index is shared by every request.
 */
export class IconD2EpsRemapIndexLoader implements IconD2EpsRemapIndexProvider {
  private ready: Promise<NearestNeighbourRemapIndex> | undefined;

  constructor(private readonly assets: IconD2EpsRemapAssetProvider) {}

  index(): Promise<NearestNeighbourRemapIndex> {
    this.ready ??= this.load().catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  private async load(): Promise<NearestNeighbourRemapIndex> {
    const { targetGridPath, weightsPath } = await this.assets.paths();
    const [gridText, weightsBytes] = await Promise.all([
      readFile(targetGridPath, "utf8"),
      readFile(weightsPath),
    ]);
    return readScripNearestNeighbourIndex(
      new Uint8Array(weightsBytes),
      parseCdoLonLatGridDescription(gridText),
    );
  }
}

/**
 * Remap one immutable all-members native ICON-D2-EPS GRIB object to DWD's
 * official 0.02 degree target grid. This is deliberately done before member
 * splitting so a request pays the remap cost once no matter how many members
 * are selected later.
 *
 * The remap is a pure-JS gather through DWD's own nearest-neighbour index, so
 * values are identical to the provider's CDO path and no native executable is
 * required. Sections 1, 2 and 4 are copied verbatim, which keeps DWD local
 * parameters, ensemble metadata and statistical intervals intact without any
 * pre/post rewriting.
 */
export class IconD2EpsGridRemapper {
  private readonly inFlight = new Map<string, Promise<IconD2SourceFile>>();

  constructor(
    private readonly rootDir: string,
    private readonly indexProvider: IconD2EpsRemapIndexProvider,
  ) {}

  async remap(path: string): Promise<IconD2SourceFile> {
    await mkdir(this.rootDir, { recursive: true });
    const key = createHash("sha256")
      .update(`dwd-icon-d2-002-nearest-neighbour-v4-js-gather\0${path}`)
      .digest("hex");
    const outputPath = join(this.rootDir, `${key}.grib2`);
    if (await exists(outputPath)) return { path: outputPath, cacheHit: true };

    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      const result = await pending;
      return { ...result, cacheHit: true };
    }

    const operation = this.materialize(path, outputPath)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  private async materialize(
    inputPath: string,
    outputPath: string,
  ): Promise<IconD2SourceFile> {
    const index = await this.indexProvider.index();
    const sourceBytes = new Uint8Array(await readFile(inputPath));
    const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(tempPath, "w");
    try {
      let messages = 0;
      for (const remapped of remapGrib2Messages(sourceBytes, index)) {
        await handle.write(remapped);
        messages += 1;
      }
      await handle.close();
      if (messages === 0) {
        throw new Error("ICON-D2-EPS remap produced no GRIB2 messages");
      }
      await rename(tempPath, outputPath);
      return { path: outputPath, cacheHit: false };
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(tempPath, { force: true });
      throw error;
    }
  }
}

export class IconD2EpsRemappedSubsetCache implements IconD2SubsetCache {
  constructor(
    private readonly source: IconD2SubsetCache,
    private readonly remapper: Pick<IconD2EpsGridRemapper, "remap">,
  ) {}

  async fetch(request: IconD2DataRequest): Promise<IconD2SourceFile> {
    const sourceFile = await this.source.fetch(request);
    const remapped = await this.remapper.remap(sourceFile.path);
    return {
      path: remapped.path,
      cacheHit: sourceFile.cacheHit && remapped.cacheHit,
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

export function extractSelectedTarFiles(
  tarBytes: Uint8Array,
  wantedBasenames: ReadonlySet<string>,
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (let offset = 0; offset + 512 <= tarBytes.byteLength;) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = tarString(header.subarray(0, 100));
    const prefix = tarString(header.subarray(345, 500));
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = tarOctal(header.subarray(124, 136));
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tarBytes.byteLength) {
      throw new Error("DWD ICON-D2 remapping bundle contains a truncated tar entry");
    }

    const fileName = basename(fullName);
    if (wantedBasenames.has(fileName)) {
      files.set(fileName, tarBytes.slice(dataStart, dataEnd));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

function tarString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end)).trim();
}

function tarOctal(bytes: Uint8Array): number {
  const raw = tarString(bytes).replace(/^0+/, "");
  if (raw === "") return 0;
  const value = Number.parseInt(raw, 8);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid tar size field in DWD ICON-D2 remapping bundle: ${raw}`);
  }
  return value;
}

function isBzip2(bytes: Uint8Array): boolean {
  return bytes.length >= 3
    && bytes[0] === 0x42
    && bytes[1] === 0x5a
    && bytes[2] === 0x68;
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, bytes);
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
