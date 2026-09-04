import { createHash } from "node:crypto";
import { FileArtifactCache } from "./artifact-cache.js";
import type {
  NomadsAreaGribSource,
  NomadsAreaRequest,
  NomadsPointGribSource,
} from "../sources/nomads.js";
import type { ProfileDataRequest, ProfileSourceFile } from "../sources/types.js";

export class NomadsCache {
  private readonly artifacts: FileArtifactCache;

  constructor(
    rootDir: string,
    private readonly source: NomadsPointGribSource,
  ) {
    this.artifacts = new FileArtifactCache(rootDir);
  }

  fetch(request: ProfileDataRequest): Promise<ProfileSourceFile> {
    return this.artifacts.getOrCreateFile(
      `${pointRequestKey(request)}.grib2`,
      () => this.source.fetchPoint(request),
    );
  }
}

export class NomadsAreaCache {
  private readonly artifacts: FileArtifactCache;

  constructor(
    rootDir: string,
    private readonly source: NomadsAreaGribSource,
  ) {
    this.artifacts = new FileArtifactCache(rootDir);
  }

  fetch(request: NomadsAreaRequest): Promise<ProfileSourceFile> {
    return this.artifacts.getOrCreateFile(
      `${areaRequestKey(request)}.grib2`,
      () => this.source.fetchArea(request),
    );
  }
}

function pointRequestKey(request: ProfileDataRequest): string {
  return hashRequest({
    kind: "point",
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    grid: request.grid ?? "0p25",
    latitude: request.latitude,
    longitude: request.longitude,
    variables: canonicalVariableCodes(request.variables),
    pressureLevelsHpa: canonicalPressureLevels(request.pressureLevelsHpa),
    fields: canonicalFields(request.fields ?? []),
  });
}

function areaRequestKey(request: NomadsAreaRequest): string {
  return hashRequest({
    kind: "area",
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    grid: request.grid ?? "0p25",
    westLongitude: request.westLongitude,
    eastLongitude: request.eastLongitude,
    southLatitude: request.southLatitude,
    northLatitude: request.northLatitude,
    variables: canonicalVariableCodes(request.variables),
    pressureLevelsHpa: canonicalPressureLevels(request.pressureLevelsHpa),
    fields: canonicalFields(request.fields ?? []),
  });
}

function hashRequest(canonical: object): string {
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function canonicalVariableCodes(variables: readonly { gfsCode: string }[]): string[] {
  return [...new Set(variables.map((variable) => variable.gfsCode))].sort();
}

function canonicalPressureLevels(levels: readonly number[]): number[] {
  return [...new Set(levels)].sort((a, b) => b - a);
}

function canonicalFields(fields: readonly {
  id: string;
  gfsCode: string;
  level: { gribLevel: string; nomadsLevel: string };
  temporalSemantics: string;
}[]): string[] {
  return [...new Set(fields.map((field) => JSON.stringify({
    id: field.id,
    gfsCode: field.gfsCode,
    gribLevel: field.level.gribLevel,
    nomadsLevel: field.level.nomadsLevel,
    temporalSemantics: field.temporalSemantics,
  })))].sort();
}
