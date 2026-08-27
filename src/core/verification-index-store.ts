import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { verificationIndexRecordSchema, type VerificationIndexRecord } from "../schema/verification-index.js";
import { canonicalSelection } from "./history-index-store.js";

export const VERIFICATION_INDEX_FILENAME = "evaluations.jsonl";

export interface VerificationIndexStoreOptions {
  path?: string;
  cacheDir?: string;
}

export class VerificationIndexStore {
  readonly path: string;

  constructor(options: VerificationIndexStoreOptions = {}) {
    this.path = options.path
      ?? process.env.WFG_VERIFICATION_INDEX_PATH
      ?? join(
        options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg"),
        "verification-index",
        VERIFICATION_INDEX_FILENAME,
      );
  }

  async readAll(): Promise<VerificationIndexRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    const records = new Map<string, VerificationIndexRecord>();
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid verification index JSON at ${this.path}:${index + 1}: ${errorMessage(error)}`);
      }
      let record: VerificationIndexRecord;
      try {
        record = verificationIndexRecordSchema.parse(json);
      } catch (error) {
        throw new Error(`Invalid verification index record at ${this.path}:${index + 1}: ${errorMessage(error)}`);
      }
      records.set(verificationRequestKey(record), record);
    }
    return [...records.values()].sort((left, right) =>
      left.request.validTime.localeCompare(right.request.validTime)
      || left.request.leadHours - right.request.leadHours
      || left.referenceDataset.localeCompare(right.referenceDataset)
    );
  }

  async append(records: readonly VerificationIndexRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const existing = new Set((await this.readAll()).map(verificationRequestKey));
    const unique = new Map<string, VerificationIndexRecord>();
    for (const input of records) {
      const record = verificationIndexRecordSchema.parse(input);
      const key = verificationRequestKey(record);
      if (!existing.has(key)) unique.set(key, record);
    }
    if (unique.size === 0) return 0;

    await mkdir(dirname(this.path), { recursive: true });
    const payload = [...unique.values()].map((record) => JSON.stringify(record)).join("\n") + "\n";
    await appendFile(this.path, payload, "utf8");
    return unique.size;
  }
}

export function verificationRequestKey(record: VerificationIndexRecord): string {
  return verificationRequestKeyFromParts({
    referenceDataset: record.referenceDataset,
    requestedPoint: record.request.requestedPoint,
    validTime: record.request.validTime,
    leadHours: record.request.leadHours,
    variables: record.request.variables,
    pressureLevelsHpa: record.request.pressureLevelsHpa,
    ...(record.referenceDataset === "igra"
      ? {
          ...(record.request.gfsGrid === undefined ? {} : { gfsGrid: record.request.gfsGrid }),
          ...(record.request.stationId === undefined ? {} : { stationId: record.request.stationId }),
          maxStationDistanceKm: record.request.maxStationDistanceKm,
        }
      : {}),
  });
}

export function verificationRequestKeyFromParts(input: {
  referenceDataset: "gfs-analysis" | "igra";
  requestedPoint: { latitude: number; longitude: number };
  validTime: string;
  leadHours: number;
  variables: readonly string[];
  pressureLevelsHpa: readonly number[];
  gfsGrid?: "0p25" | "0p50";
  stationId?: string;
  maxStationDistanceKm?: number;
}): string {
  return [
    input.referenceDataset,
    new Date(input.validTime).toISOString(),
    input.leadHours,
    canonicalPoint(input.requestedPoint.latitude, input.requestedPoint.longitude),
    canonicalSelection(input.variables, input.pressureLevelsHpa),
    input.gfsGrid ?? "",
    input.stationId ?? "",
    input.referenceDataset === "igra" ? (input.maxStationDistanceKm ?? 250) : "",
  ].join("|");
}

export function verificationCaseIdentity(record: VerificationIndexRecord): string {
  const actualReference = record.referenceDataset === "gfs-analysis"
    ? canonicalPoint(record.result.gridPoint.latitude, record.result.gridPoint.longitude)
    : record.result.station.id;
  const grid = record.referenceDataset === "igra" ? record.result.gfsGrid : "0p50";
  return [
    record.referenceDataset,
    record.result.validTime,
    record.result.leadHours,
    actualReference,
    grid,
    canonicalSelection(record.request.variables, record.request.pressureLevelsHpa),
  ].join("|");
}

function canonicalPoint(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)},${normalizeLongitude(longitude).toFixed(6)}`;
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
