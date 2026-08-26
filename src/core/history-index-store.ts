import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  historicalIndexRecordSchema,
  type HistoricalIndexRecord,
} from "../schema/history-index.js";

export const HISTORICAL_INDEX_FILENAME = "profiles.jsonl";

export interface HistoricalProfileIndexStoreOptions {
  path?: string;
  cacheDir?: string;
}

/**
 * Append-only JSONL store for materialized historical GFS profiles.
 *
 * Reads are deduplicated by semantic record key with the latest appended record
 * winning. Keeping the storage format deliberately boring makes the index
 * portable across npm/Docker installations and lets future bulk archive
 * ingesters populate the same materialization without changing analog semantics.
 */
export class HistoricalProfileIndexStore {
  readonly path: string;

  constructor(options: HistoricalProfileIndexStoreOptions = {}) {
    this.path = options.path
      ?? process.env.WFG_HISTORY_INDEX_PATH
      ?? join(
        options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg"),
        "history-index",
        HISTORICAL_INDEX_FILENAME,
      );
  }

  async readAll(): Promise<HistoricalIndexRecord[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    const deduped = new Map<string, HistoricalIndexRecord>();
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid historical index JSON at ${this.path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const record = historicalIndexRecordSchema.parse(parsedJson);
      deduped.set(historicalIndexRecordKey(record), record);
    }
    return [...deduped.values()].sort((a, b) => a.analysisTime.localeCompare(b.analysisTime));
  }

  async append(records: readonly HistoricalIndexRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const existingKeys = new Set((await this.readAll()).map(historicalIndexRecordKey));
    const unique = new Map<string, HistoricalIndexRecord>();
    for (const recordInput of records) {
      const record = historicalIndexRecordSchema.parse(recordInput);
      const key = historicalIndexRecordKey(record);
      if (!existingKeys.has(key)) unique.set(key, record);
    }
    if (unique.size === 0) return 0;

    await mkdir(dirname(this.path), { recursive: true });
    const payload = [...unique.values()].map((record) => JSON.stringify(record)).join("\n") + "\n";
    await appendFile(this.path, payload, "utf8");
    return unique.size;
  }
}

export function historicalIndexRecordKey(record: HistoricalIndexRecord): string {
  return [
    record.model,
    record.analysisTime,
    canonicalGridPoint(record.gridPoint.latitude, record.gridPoint.longitude),
    canonicalSelection(record.selection.variables, record.selection.pressureLevelsHpa),
  ].join("|");
}

export function canonicalSelection(
  variables: readonly string[],
  pressureLevelsHpa: readonly number[],
): string {
  const normalizedVariables = [...new Set(variables)].sort();
  const normalizedLevels = [...new Set(pressureLevelsHpa)].sort((a, b) => b - a);
  return `${normalizedVariables.join(",")}@${normalizedLevels.join(",")}`;
}

export function sameGridPoint(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): boolean {
  return Math.abs(a.latitude - b.latitude) < 1e-9
    && circularLongitudeDifference(a.longitude, b.longitude) < 1e-9;
}

function canonicalGridPoint(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)},${normalizeLongitude(longitude).toFixed(6)}`;
}

function circularLongitudeDifference(a: number, b: number): number {
  const delta = Math.abs(normalizeLongitude(a) - normalizeLongitude(b));
  return Math.min(delta, 360 - delta);
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
