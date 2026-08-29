import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_ACCESS_POLICY_STALE_LOCK_MS = 120_000;
const DEFAULT_POLL_MS = 100;

export interface UpstreamAccessPolicy {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface UpstreamAccessPolicyDefinition {
  id: string;
  maxConcurrency: number;
  minIntervalMs: number;
  staleLockMs?: number;
}

export const UPSTREAM_ACCESS_POLICIES = {
  nomads: {
    id: "nomads",
    maxConcurrency: 1,
    minIntervalMs: 11_000,
  },
  noaaAws: {
    id: "noaa-aws",
    maxConcurrency: 8,
    minIntervalMs: 0,
  },
  ecmwfCloud: {
    id: "ecmwf-cloud",
    maxConcurrency: 8,
    minIntervalMs: 0,
  },
  ecmwfDirect: {
    id: "ecmwf-direct",
    maxConcurrency: 4,
    minIntervalMs: 0,
  },
  nceiThredds: {
    id: "ncei-thredds",
    maxConcurrency: 2,
    minIntervalMs: 0,
  },
  gdex: {
    id: "gdex",
    maxConcurrency: 4,
    minIntervalMs: 0,
  },
  nceiIgra: {
    id: "ncei-igra",
    maxConcurrency: 4,
    minIntervalMs: 0,
  },
} as const satisfies Record<string, UpstreamAccessPolicyDefinition>;

interface State {
  lastRequestCompletedAt: number;
}

export class FileAccessPolicy implements UpstreamAccessPolicy {
  private readonly staleLockMs: number;

  constructor(
    private readonly rootDir: string,
    private readonly definition: UpstreamAccessPolicyDefinition,
    private readonly pollMs = DEFAULT_POLL_MS,
  ) {
    if (!definition.id.match(/^[a-z0-9-]+$/)) {
      throw new Error("access policy id must contain only lowercase letters, digits, and hyphens");
    }
    if (!Number.isInteger(definition.maxConcurrency) || definition.maxConcurrency < 1) {
      throw new Error("access policy maxConcurrency must be a positive integer");
    }
    if (!Number.isFinite(definition.minIntervalMs) || definition.minIntervalMs < 0) {
      throw new Error("access policy minIntervalMs must be non-negative");
    }
    if (definition.minIntervalMs > 0 && definition.maxConcurrency !== 1) {
      throw new Error("access policies with a minimum interval must use maxConcurrency=1");
    }
    this.staleLockMs = definition.staleLockMs ?? DEFAULT_ACCESS_POLICY_STALE_LOCK_MS;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.rootDir, { recursive: true });
    const slot = await this.acquireSlot();
    const stopHeartbeat = this.startHeartbeat(slot);

    try {
      if (this.definition.minIntervalMs > 0) {
        const state = await this.readState();
        const waitMs = Math.max(
          0,
          state.lastRequestCompletedAt + this.definition.minIntervalMs - Date.now(),
        );
        if (waitMs > 0) await sleep(waitMs);
      }

      try {
        return await operation();
      } finally {
        if (this.definition.minIntervalMs > 0) {
          await writeFile(
            this.statePath(),
            JSON.stringify({ lastRequestCompletedAt: Date.now() } satisfies State),
            "utf8",
          );
        }
      }
    } finally {
      stopHeartbeat();
      await rm(this.slotPath(slot), { recursive: true, force: true });
    }
  }

  private startHeartbeat(slot: number): () => void {
    const path = this.slotPath(slot);
    const intervalMs = Math.max(1, Math.floor(this.staleLockMs / 3));
    const timer = setInterval(() => {
      const now = new Date();
      void utimes(path, now, now).catch(() => undefined);
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  private async acquireSlot(): Promise<number> {
    for (;;) {
      for (let slot = 0; slot < this.definition.maxConcurrency; slot += 1) {
        const path = this.slotPath(slot);
        try {
          await mkdir(path);
          return slot;
        } catch (error) {
          if (!isAlreadyExists(error)) throw error;

          try {
            const lockStat = await stat(path);
            if (Date.now() - lockStat.mtimeMs > this.staleLockMs) {
              await rm(path, { recursive: true, force: true });
            }
          } catch {
            // Another process may have released the slot between checks.
          }
        }
      }
      await sleep(this.pollMs);
    }
  }

  private slotPath(slot: number): string {
    if (this.definition.maxConcurrency === 1) {
      return join(this.rootDir, `${this.definition.id}.lock`);
    }
    return join(this.rootDir, `${this.definition.id}.slot-${slot}.lock`);
  }

  private statePath(): string {
    return join(this.rootDir, `${this.definition.id}-state.json`);
  }

  private async readState(): Promise<State> {
    try {
      return JSON.parse(await readFile(this.statePath(), "utf8")) as State;
    } catch {
      return { lastRequestCompletedAt: 0 };
    }
  }
}

export function withLegacyCooldown(
  definition: UpstreamAccessPolicyDefinition,
  cooldownMs: number | undefined,
): UpstreamAccessPolicyDefinition {
  if (cooldownMs === undefined) return definition;
  return {
    ...definition,
    maxConcurrency: 1,
    minIntervalMs: cooldownMs,
  };
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
