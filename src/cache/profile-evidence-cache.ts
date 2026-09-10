import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PROFILE_EVIDENCE_CACHE_VERSION = 1;
const DEFAULT_MAX_VARIANTS = 6;

export interface ProfileEvidenceIdentity {
  dataset: string;
  run: string;
  validTime: string;
  latitude: number;
  longitude: number;
  variant?: string;
  source?: string;
  population?: string;
}

export interface ProfileEvidenceSelection {
  pressureVariables: readonly string[];
  pressureLevelsHpa: readonly number[];
  fields: readonly string[];
}

interface StoredProfileEvidence<T> {
  version: typeof PROFILE_EVIDENCE_CACHE_VERSION;
  identity: ProfileEvidenceIdentity;
  entries: Array<{
    selection: ProfileEvidenceSelection;
    value: T;
  }>;
}

/**
 * Persistent cache for already-materialized point/profile evidence.
 *
 * The key intentionally stops at run × valid time × sampled request point ×
 * dataset/source variant. Selections live inside the entry so a wider pressure
 * column can satisfy a later narrower diagnostic without re-acquiring or
 * re-decoding the same evidence. Values remain dataset-native and are projected
 * by the caller; this cache owns persistence/reuse only, not meteorological
 * interpretation.
 */
export class ProfileEvidenceCache<T> {
  private readonly writes = new Map<string, Promise<void>>();
  private readonly maxVariants: number;

  constructor(
    private readonly rootDir: string,
    options: { maxVariants?: number } = {},
  ) {
    this.maxVariants = options.maxVariants ?? DEFAULT_MAX_VARIANTS;
    if (!Number.isInteger(this.maxVariants) || this.maxVariants < 1) {
      throw new Error("profile evidence maxVariants must be a positive integer");
    }
  }

  async find(
    identity: ProfileEvidenceIdentity,
    selection: ProfileEvidenceSelection,
  ): Promise<T | undefined> {
    const stored = await this.read(identity);
    const requested = normalizeSelection(selection);
    const candidates = stored.entries
      .filter((entry) => covers(entry.selection, requested))
      .sort((left, right) => selectionCost(left.selection) - selectionCost(right.selection));
    return candidates[0]?.value;
  }

  async put(
    identity: ProfileEvidenceIdentity,
    selection: ProfileEvidenceSelection,
    value: T,
  ): Promise<void> {
    const path = this.path(identity);
    const previous = this.writes.get(path) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const stored = await this.read(identity);
        const normalized = normalizeSelection(selection);

        if (stored.entries.some((entry) => covers(entry.selection, normalized))) return;

        const entries = stored.entries
          .filter((entry) => !covers(normalized, entry.selection));
        entries.push({ selection: normalized, value });
        entries.sort((left, right) => selectionCost(right.selection) - selectionCost(left.selection));

        await mkdir(this.rootDir, { recursive: true });
        await writeAtomically(path, JSON.stringify({
          version: PROFILE_EVIDENCE_CACHE_VERSION,
          identity,
          entries: entries.slice(0, this.maxVariants),
        } satisfies StoredProfileEvidence<T>));
      })
      .finally(() => {
        if (this.writes.get(path) === operation) this.writes.delete(path);
      });
    this.writes.set(path, operation);
    await operation;
  }

  private async read(identity: ProfileEvidenceIdentity): Promise<StoredProfileEvidence<T>> {
    const empty = (): StoredProfileEvidence<T> => ({
      version: PROFILE_EVIDENCE_CACHE_VERSION,
      identity,
      entries: [],
    });
    try {
      const parsed = JSON.parse(await readFile(this.path(identity), "utf8")) as Partial<StoredProfileEvidence<T>>;
      if (
        parsed.version !== PROFILE_EVIDENCE_CACHE_VERSION
        || stableIdentity(parsed.identity) !== stableIdentity(identity)
        || !Array.isArray(parsed.entries)
      ) {
        return empty();
      }
      return {
        version: PROFILE_EVIDENCE_CACHE_VERSION,
        identity,
        entries: parsed.entries.filter(isStoredEntry),
      };
    } catch {
      return empty();
    }
  }

  private path(identity: ProfileEvidenceIdentity): string {
    const hash = createHash("sha256").update(stableIdentity(identity)).digest("hex");
    return join(this.rootDir, `${hash}.json`);
  }
}

function normalizeSelection(selection: ProfileEvidenceSelection): ProfileEvidenceSelection {
  return {
    pressureVariables: [...new Set(selection.pressureVariables)].sort(),
    pressureLevelsHpa: [...new Set(selection.pressureLevelsHpa)].sort((a, b) => b - a),
    fields: [...new Set(selection.fields)].sort(),
  };
}

function covers(available: ProfileEvidenceSelection, requested: ProfileEvidenceSelection): boolean {
  return isSuperset(available.pressureVariables, requested.pressureVariables)
    && isSuperset(available.pressureLevelsHpa, requested.pressureLevelsHpa)
    && isSuperset(available.fields, requested.fields);
}

function isSuperset<T>(available: readonly T[], requested: readonly T[]): boolean {
  const values = new Set(available);
  return requested.every((value) => values.has(value));
}

function selectionCost(selection: ProfileEvidenceSelection): number {
  return selection.pressureVariables.length * selection.pressureLevelsHpa.length
    + selection.fields.length;
}

function stableIdentity(identity: ProfileEvidenceIdentity | undefined): string {
  if (identity === undefined) return "";
  const ordered = Object.fromEntries(
    Object.entries(identity)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify(ordered);
}

function isStoredEntry<T>(value: unknown): value is StoredProfileEvidence<T>["entries"][number] {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.selection !== "object" || entry.selection === null || !("value" in entry)) return false;
  const selection = entry.selection as Record<string, unknown>;
  return Array.isArray(selection.pressureVariables)
    && selection.pressureVariables.every((item) => typeof item === "string")
    && Array.isArray(selection.pressureLevelsHpa)
    && selection.pressureLevelsHpa.every((item) => typeof item === "number" && Number.isFinite(item))
    && Array.isArray(selection.fields)
    && selection.fields.every((item) => typeof item === "string");
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true });
  }
}
