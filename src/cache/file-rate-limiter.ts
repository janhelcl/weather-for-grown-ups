import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_NOMADS_COOLDOWN_MS = 11_000;
export const DEFAULT_STALE_LOCK_MS = 120_000;

interface State {
  lastRequestCompletedAt: number;
}

export class FileRateLimiter {
  private readonly lockDir: string;
  private readonly statePath: string;

  constructor(
    private readonly rootDir: string,
    private readonly cooldownMs = DEFAULT_NOMADS_COOLDOWN_MS,
    private readonly staleLockMs = DEFAULT_STALE_LOCK_MS,
  ) {
    this.lockDir = join(rootDir, "nomads.lock");
    this.statePath = join(rootDir, "nomads-state.json");
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.rootDir, { recursive: true });
    await this.acquire();

    try {
      const state = await this.readState();
      const waitMs = Math.max(0, state.lastRequestCompletedAt + this.cooldownMs - Date.now());
      if (waitMs > 0) await sleep(waitMs);

      try {
        return await operation();
      } finally {
        await writeFile(
          this.statePath,
          JSON.stringify({ lastRequestCompletedAt: Date.now() } satisfies State),
          "utf8",
        );
      }
    } finally {
      await rm(this.lockDir, { recursive: true, force: true });
    }
  }

  private async acquire(): Promise<void> {
    for (;;) {
      try {
        await mkdir(this.lockDir);
        return;
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;

        try {
          const lockStat = await stat(this.lockDir);
          if (Date.now() - lockStat.mtimeMs > this.staleLockMs) {
            await rm(this.lockDir, { recursive: true, force: true });
            continue;
          }
        } catch {
          // Another process may have released the lock between checks.
        }

        await sleep(100);
      }
    }
  }

  private async readState(): Promise<State> {
    try {
      return JSON.parse(await readFile(this.statePath, "utf8")) as State;
    } catch {
      return { lastRequestCompletedAt: 0 };
    }
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
