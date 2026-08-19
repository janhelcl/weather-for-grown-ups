import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../src/cache/file-rate-limiter.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "wfg-rate-limit-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("FileRateLimiter", () => {
  it("locks the NOMADS courtesy interval to an 11 second default", () => {
    expect(DEFAULT_NOMADS_COOLDOWN_MS).toBe(11_000);
    expect(DEFAULT_NOMADS_COOLDOWN_MS).toBeGreaterThan(10_000);
  });

  it("runs an operation, persists completion time, and releases the lock", async () => {
    const limiter = new FileRateLimiter(rootDir, 0);
    await expect(limiter.run(async () => 42)).resolves.toBe(42);

    const state = JSON.parse(await readFile(join(rootDir, "nomads-state.json"), "utf8")) as {
      lastRequestCompletedAt: number;
    };
    expect(state.lastRequestCompletedAt).toBeGreaterThan(0);
    await expect(access(join(rootDir, "nomads.lock"))).rejects.toThrow();
  });

  it("serializes concurrent callers sharing the same state directory", async () => {
    const first = new FileRateLimiter(rootDir, 0);
    const second = new FileRateLimiter(rootDir, 0);
    let active = 0;
    let maxActive = 0;

    const operation = async (value: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active -= 1;
      return value;
    };

    const values = await Promise.all([
      first.run(() => operation("first")),
      second.run(() => operation("second")),
    ]);

    expect(values).toEqual(["first", "second"]);
    expect(maxActive).toBe(1);
  });

  it("waits for the configured cooldown after a completed request", async () => {
    const limiter = new FileRateLimiter(rootDir, 35);
    await limiter.run(async () => undefined);

    const started = Date.now();
    await limiter.run(async () => undefined);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("records completion and releases the lock even when the operation fails", async () => {
    const limiter = new FileRateLimiter(rootDir, 0);
    await expect(
      limiter.run(async () => {
        throw new Error("upstream failed");
      }),
    ).rejects.toThrow("upstream failed");

    const state = JSON.parse(await readFile(join(rootDir, "nomads-state.json"), "utf8")) as {
      lastRequestCompletedAt: number;
    };
    expect(state.lastRequestCompletedAt).toBeGreaterThan(0);
    await expect(limiter.run(async () => "recovered")).resolves.toBe("recovered");
  });

  it("recovers an abandoned stale lock", async () => {
    const lockDir = join(rootDir, "nomads.lock");
    await mkdir(lockDir, { recursive: true });
    const old = new Date(Date.now() - 10_000);
    await utimes(lockDir, old, old);

    const limiter = new FileRateLimiter(rootDir, 0, 1);
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });

  it("treats corrupt state as empty state rather than blocking requests", async () => {
    await writeFile(join(rootDir, "nomads-state.json"), "not-json", "utf8");
    const limiter = new FileRateLimiter(rootDir, 1_000);
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });
});
