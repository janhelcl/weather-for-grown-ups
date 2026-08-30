import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
} from "../src/access/access-policy.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "wfg-access-policy-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("upstream access policy registry", () => {
  it("keeps NOMADS pacing separate from bounded-concurrency providers", () => {
    expect(UPSTREAM_ACCESS_POLICIES.nomads).toMatchObject({
      maxConcurrency: 1,
      minIntervalMs: 11_000,
    });
    expect(UPSTREAM_ACCESS_POLICIES.nceiThredds).toMatchObject({
      maxConcurrency: 2,
      minIntervalMs: 0,
    });
    expect(UPSTREAM_ACCESS_POLICIES.gdex).toMatchObject({
      maxConcurrency: 4,
      minIntervalMs: 0,
    });
    expect(UPSTREAM_ACCESS_POLICIES.nceiIgra).toMatchObject({
      maxConcurrency: 4,
      minIntervalMs: 0,
    });
  });

  it("records bounded defaults for cloud object access without adding a courtesy delay", () => {
    expect(UPSTREAM_ACCESS_POLICIES.noaaAws).toMatchObject({
      maxConcurrency: 8,
      minIntervalMs: 0,
    });
    expect(UPSTREAM_ACCESS_POLICIES.ecmwfCloud).toMatchObject({
      maxConcurrency: 8,
      minIntervalMs: 0,
    });
    expect(UPSTREAM_ACCESS_POLICIES.ecmwfDirect).toMatchObject({
      maxConcurrency: 4,
      minIntervalMs: 0,
    });
  });
});

describe("FileAccessPolicy", () => {
  it("enforces a shared cross-process-style concurrency ceiling", async () => {
    const policy = new FileAccessPolicy(rootDir, UPSTREAM_ACCESS_POLICIES.gdex, 1);
    let active = 0;
    let maxActive = 0;

    await Promise.all(Array.from({ length: 8 }, (_, index) => policy.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active -= 1;
      return index;
    })));

    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(UPSTREAM_ACCESS_POLICIES.gdex.maxConcurrency);
  });

  it("does not make unrelated providers share lock slots", async () => {
    const ncei = new FileAccessPolicy(rootDir, {
      id: "test-ncei",
      maxConcurrency: 1,
      minIntervalMs: 0,
    }, 1);
    const igra = new FileAccessPolicy(rootDir, {
      id: "test-igra",
      maxConcurrency: 1,
      minIntervalMs: 0,
    }, 1);
    let active = 0;
    let maxActive = 0;

    const operation = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active -= 1;
    };

    await Promise.all([
      ncei.run(operation),
      igra.run(operation),
    ]);

    expect(maxActive).toBe(2);
  });

  it("heartbeats long-running slots so they are not mistaken for stale locks", async () => {
    const definition = {
      id: "heartbeat-test",
      maxConcurrency: 1,
      minIntervalMs: 0,
      staleLockMs: 50,
    };
    const first = new FileAccessPolicy(rootDir, definition, 5);
    const second = new FileAccessPolicy(rootDir, definition, 5);
    let active = 0;
    let maxActive = 0;

    const firstRun = first.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(160);
      active -= 1;
    });

    await delay(80);
    const secondRun = second.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active -= 1;
    });

    await Promise.all([firstRun, secondRun]);
    expect(maxActive).toBe(1);
  });

  it("rejects malformed provider policy definitions", () => {
    expect(() => new FileAccessPolicy(rootDir, {
      id: "Bad Provider",
      maxConcurrency: 1,
      minIntervalMs: 0,
    })).toThrow(/policy id/);

    expect(() => new FileAccessPolicy(rootDir, {
      id: "bad-concurrency",
      maxConcurrency: 0,
      minIntervalMs: 0,
    })).toThrow(/maxConcurrency/);

    expect(() => new FileAccessPolicy(rootDir, {
      id: "bad-interval",
      maxConcurrency: 1,
      minIntervalMs: -1,
    })).toThrow(/minIntervalMs/);
  });

  it("rejects an ambiguous interval-plus-concurrency policy", () => {
    expect(() => new FileAccessPolicy(rootDir, {
      id: "invalid",
      maxConcurrency: 2,
      minIntervalMs: 10,
    })).toThrow(/maxConcurrency=1/);
  });
});
