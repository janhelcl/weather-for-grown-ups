import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { IconD2EpsMember } from "../catalog/icon-d2-eps.js";
import type {
  IconD2AvailabilityRequirement,
  IconD2DataRequest,
  IconD2SourceFile,
  IconD2SubsetCache,
} from "./icon-d2-open-data-cache.js";
import { IconD2EpsMemberFileFilter } from "./icon-d2-eps-open-data-cache.js";
import { IconD2EpsCdoRemapper } from "./icon-d2-eps-remap-cache.js";

/**
 * Most ICON-D2-EPS parameters are remapped once as an all-members object and
 * split afterward. DWD DBZ_CMAX is an exception: CDO drops its perturbation
 * metadata when remapping the all-members object, so that parameter must be
 * split by member first and only then remapped.
 *
 * A request may contain both kinds. Keep the exceptional field isolated
 * instead of forcing unrelated parameters through the member-first path:
 * ordinary variables/fields use remap -> member split, DBZ_CMAX uses member
 * split -> remap, and the two per-member GRIBs are combined afterward.
 */
export class IconD2EpsAdaptiveMemberSubsetCache implements IconD2SubsetCache {
  constructor(
    private readonly source: IconD2SubsetCache,
    private readonly remapper: IconD2EpsCdoRemapper,
    private readonly filter: IconD2EpsMemberFileFilter,
    private readonly combiner: IconD2EpsMemberFileCombiner,
    private readonly member: IconD2EpsMember,
  ) {}

  async fetch(request: IconD2DataRequest): Promise<IconD2SourceFile> {
    const memberFirstFields = request.fields.filter(
      (field) => field.id === "column_maximum_reflectivity",
    );
    const ordinaryFields = request.fields.filter(
      (field) => field.id !== "column_maximum_reflectivity",
    );
    const hasOrdinary = request.variables.length > 0 || ordinaryFields.length > 0;
    const hasMemberFirst = memberFirstFields.length > 0;

    if (!hasMemberFirst) {
      return this.fetchRemapFirst(request);
    }
    if (!hasOrdinary) {
      return this.fetchMemberFirst(request);
    }

    const ordinaryRequest: IconD2DataRequest = {
      ...request,
      fields: ordinaryFields,
    };
    const memberFirstRequest: IconD2DataRequest = {
      ...request,
      variables: [],
      pressureLevelsHpa: [],
      fields: memberFirstFields,
    };
    const [ordinary, exceptional] = await Promise.all([
      this.fetchRemapFirst(ordinaryRequest),
      this.fetchMemberFirst(memberFirstRequest),
    ]);
    return this.combiner.combine([ordinary, exceptional]);
  }

  isForecastAvailable(
    run: Date,
    forecastHour: number,
    requirement: IconD2AvailabilityRequirement,
  ): Promise<boolean> {
    return this.source.isForecastAvailable(run, forecastHour, requirement);
  }

  private async fetchRemapFirst(request: IconD2DataRequest): Promise<IconD2SourceFile> {
    const sourceFile = await this.source.fetch(request);
    const remapped = await this.remapper.remap(sourceFile.path);
    const memberFile = await this.filter.filter(remapped.path, this.member);
    return {
      path: memberFile.path,
      cacheHit: sourceFile.cacheHit && remapped.cacheHit && memberFile.cacheHit,
    };
  }

  private async fetchMemberFirst(request: IconD2DataRequest): Promise<IconD2SourceFile> {
    const sourceFile = await this.source.fetch(request);
    const memberFile = await this.filter.filter(sourceFile.path, this.member);
    const remapped = await this.remapper.remap(memberFile.path);
    return {
      path: remapped.path,
      cacheHit: sourceFile.cacheHit && memberFile.cacheHit && remapped.cacheHit,
    };
  }
}

export class IconD2EpsMemberFileCombiner {
  private readonly inFlight = new Map<string, Promise<IconD2SourceFile>>();

  constructor(private readonly rootDir: string) {}

  async combine(files: readonly IconD2SourceFile[]): Promise<IconD2SourceFile> {
    if (files.length === 0) {
      throw new Error("ICON-D2-EPS member combiner requires at least one GRIB file");
    }
    if (files.length === 1) return files[0]!;

    await mkdir(this.rootDir, { recursive: true });
    const key = createHash("sha256")
      .update(files.map((file) => file.path).join("\0"))
      .digest("hex");
    const outputPath = join(this.rootDir, `${key}.grib2`);
    const allInputsCached = files.every((file) => file.cacheHit);
    if (await exists(outputPath)) {
      return { path: outputPath, cacheHit: allInputsCached };
    }

    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      const result = await pending;
      return { path: result.path, cacheHit: allInputsCached };
    }

    const operation = this.materialize(files, outputPath)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  private async materialize(
    files: readonly IconD2SourceFile[],
    outputPath: string,
  ): Promise<IconD2SourceFile> {
    const chunks = await Promise.all(files.map((file) => readFile(file.path)));
    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, combined);
      await rename(tempPath, outputPath);
      return { path: outputPath, cacheHit: false };
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }
}

export function iconD2EpsRequiresMemberFirstRemap(
  request: IconD2DataRequest,
): boolean {
  return request.fields.some((field) => field.id === "column_maximum_reflectivity");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
