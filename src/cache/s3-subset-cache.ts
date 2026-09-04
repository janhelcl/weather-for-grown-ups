import { createHash } from "node:crypto";
import { FileArtifactCache } from "./artifact-cache.js";
import type { GfsS3SubsetSource } from "../sources/gfs-s3.js";
import type { ProfileDataRequest, ProfileSourceFile } from "../sources/types.js";

export class GfsS3SubsetCache {
  private readonly artifacts: FileArtifactCache;

  constructor(
    rootDir: string,
    private readonly source: GfsS3SubsetSource,
  ) {
    this.artifacts = new FileArtifactCache(rootDir);
  }

  async fetch(request: ProfileDataRequest): Promise<ProfileSourceFile> {
    return this.artifacts.getOrCreateFile(
      `${subsetKey(request)}.grib2`,
      async () => {
        const index = await this.artifacts.getOrCreateText(
          `${forecastKey(request)}.idx`,
          () => this.source.fetchIndex(request),
        );
        return this.source.fetchSubset(request, index.value);
      },
    );
  }
}

function forecastKey(request: ProfileDataRequest): string {
  const canonical = JSON.stringify({
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    grid: request.grid ?? "0p25",
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function subsetKey(request: ProfileDataRequest): string {
  const canonical = JSON.stringify({
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    grid: request.grid ?? "0p25",
    variables: [...new Set(request.variables.map((variable) => variable.gfsCode))].sort(),
    pressureLevelsHpa: [...new Set(request.pressureLevelsHpa)].sort((a, b) => b - a),
    fields: canonicalFields(request),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalFields(request: ProfileDataRequest): string[] {
  return [...new Set((request.fields ?? []).map((field) => JSON.stringify({
    id: field.id,
    gfsCode: field.gfsCode,
    gribLevel: field.level.gribLevel,
    temporalSemantics: field.temporalSemantics,
  })))].sort();
}
