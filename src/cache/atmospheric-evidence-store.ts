import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const EVIDENCE_STORE_VERSION = 1;
const DEFAULT_MAX_VARIANTS = 6;

export type AtmosphericEvidenceIdentity = Readonly<Record<string, string | number | boolean | undefined>>;

export interface AtmosphericEvidenceSelectionPolicy<TSelection> {
  normalize(selection: TSelection): TSelection;
  covers(available: TSelection, requested: TSelection): boolean;
  cost(selection: TSelection): number;
  isSelection(value: unknown): value is TSelection;
}

export interface AtmosphericEvidenceStore<TSelection, TEvidence> {
  find(identity: AtmosphericEvidenceIdentity, selection: TSelection): Promise<TEvidence | undefined>;
  put(identity: AtmosphericEvidenceIdentity, selection: TSelection, value: TEvidence): Promise<void>;
}

interface StoredEvidence<TSelection, TEvidence> {
  version: typeof EVIDENCE_STORE_VERSION;
  identity: AtmosphericEvidenceIdentity;
  entries: Array<{ selection: TSelection; value: TEvidence }>;
}

/**
 * Persistent, bounded storage for immutable run-resolved atmospheric evidence.
 * Meteorological compatibility is delegated to the selection policy: this layer
 * knows how to persist/reuse evidence, not what evidence means.
 */
export class PersistentAtmosphericEvidenceStore<TSelection, TEvidence>
implements AtmosphericEvidenceStore<TSelection, TEvidence> {
  private readonly writes = new Map<string, Promise<void>>();
  private readonly maxVariants: number;

  constructor(
    private readonly rootDir: string,
    private readonly policy: AtmosphericEvidenceSelectionPolicy<TSelection>,
    options: { maxVariants?: number } = {},
  ) {
    this.maxVariants = options.maxVariants ?? DEFAULT_MAX_VARIANTS;
    if (!Number.isInteger(this.maxVariants) || this.maxVariants < 1) {
      throw new Error("atmospheric evidence maxVariants must be a positive integer");
    }
  }

  async find(identity: AtmosphericEvidenceIdentity, selection: TSelection): Promise<TEvidence | undefined> {
    const stored = await this.read(identity);
    const requested = this.policy.normalize(selection);
    const candidates = stored.entries
      .filter((entry) => this.policy.covers(entry.selection, requested))
      .sort((left, right) => this.policy.cost(left.selection) - this.policy.cost(right.selection));
    return candidates[0]?.value;
  }

  async put(identity: AtmosphericEvidenceIdentity, selection: TSelection, value: TEvidence): Promise<void> {
    const path = this.path(identity);
    const previous = this.writes.get(path) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const stored = await this.read(identity);
        const normalized = this.policy.normalize(selection);
        if (stored.entries.some((entry) => this.policy.covers(entry.selection, normalized))) return;

        const entries = stored.entries.filter((entry) => !this.policy.covers(normalized, entry.selection));
        entries.push({ selection: normalized, value });
        entries.sort((left, right) => this.policy.cost(right.selection) - this.policy.cost(left.selection));

        await mkdir(this.rootDir, { recursive: true });
        await writeAtomically(path, JSON.stringify({
          version: EVIDENCE_STORE_VERSION,
          identity,
          entries: entries.slice(0, this.maxVariants),
        } satisfies StoredEvidence<TSelection, TEvidence>));
      })
      .finally(() => {
        if (this.writes.get(path) === operation) this.writes.delete(path);
      });
    this.writes.set(path, operation);
    await operation;
  }

  private async read(identity: AtmosphericEvidenceIdentity): Promise<StoredEvidence<TSelection, TEvidence>> {
    const empty = (): StoredEvidence<TSelection, TEvidence> => ({
      version: EVIDENCE_STORE_VERSION,
      identity,
      entries: [],
    });
    try {
      const parsed = JSON.parse(await readFile(this.path(identity), "utf8")) as Partial<StoredEvidence<unknown, TEvidence>>;
      if (
        parsed.version !== EVIDENCE_STORE_VERSION
        || stableEvidenceKey(parsed.identity) !== stableEvidenceKey(identity)
        || !Array.isArray(parsed.entries)
      ) return empty();

      return {
        version: EVIDENCE_STORE_VERSION,
        identity,
        entries: parsed.entries.filter((entry): entry is { selection: TSelection; value: TEvidence } =>
          typeof entry === "object" && entry !== null
          && "selection" in entry && this.policy.isSelection(entry.selection)
          && "value" in entry),
      };
    } catch {
      return empty();
    }
  }

  private path(identity: AtmosphericEvidenceIdentity): string {
    const hash = createHash("sha256").update(stableEvidenceKey(identity)).digest("hex");
    return join(this.rootDir, `${hash}.json`);
  }
}

export function stableEvidenceKey(value: unknown): string {
  return JSON.stringify(sortSerializable(value));
}

function sortSerializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortSerializable);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortSerializable(item)]),
  );
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
