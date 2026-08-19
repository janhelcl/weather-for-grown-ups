import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LATEST_RUN_LOOKBACK_CYCLES,
  DEFAULT_LATEST_RUN_TTL_MS,
  floorToGfsCycle,
  LatestRunResolver,
} from "../src/core/latest-run.js";

describe("floorToGfsCycle", () => {
  it.each([
    ["2026-08-19T00:00:00Z", "2026-08-19T00:00:00.000Z"],
    ["2026-08-19T05:59:59Z", "2026-08-19T00:00:00.000Z"],
    ["2026-08-19T06:00:00Z", "2026-08-19T06:00:00.000Z"],
    ["2026-08-19T11:59:59Z", "2026-08-19T06:00:00.000Z"],
    ["2026-08-19T14:41:00Z", "2026-08-19T12:00:00.000Z"],
    ["2026-08-19T23:59:59Z", "2026-08-19T18:00:00.000Z"],
  ])("floors %s to the containing GFS cycle", (input, expected) => {
    expect(floorToGfsCycle(new Date(input)).toISOString()).toBe(expected);
  });

  it("does not mutate the input date", () => {
    const input = new Date("2026-08-19T14:41:12.345Z");
    floorToGfsCycle(input);
    expect(input.toISOString()).toBe("2026-08-19T14:41:12.345Z");
  });
});

describe("LatestRunResolver", () => {
  it("keeps conservative defaults for lookback and cache freshness", () => {
    expect(DEFAULT_LATEST_RUN_LOOKBACK_CYCLES).toBe(8);
    expect(DEFAULT_LATEST_RUN_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("walks backward from the current cycle until it finds a complete run", async () => {
    const isRunComplete = vi.fn(async (candidate: Date) => candidate.getUTCHours() === 6);
    const resolver = new LatestRunResolver(
      { isRunComplete },
      () => Date.parse("2026-08-19T14:41:00Z"),
      60_000,
      4,
    );

    await expect(resolver.resolveLatestRun()).resolves.toEqual(new Date("2026-08-19T06:00:00Z"));
    expect(isRunComplete.mock.calls.map(([candidate]) => candidate.toISOString())).toEqual([
      "2026-08-19T12:00:00.000Z",
      "2026-08-19T06:00:00.000Z",
    ]);
  });

  it("crosses the UTC date boundary while walking back", async () => {
    const isRunComplete = vi.fn(async (candidate: Date) => candidate.toISOString() === "2026-08-18T18:00:00.000Z");
    const resolver = new LatestRunResolver(
      { isRunComplete },
      () => Date.parse("2026-08-19T02:00:00Z"),
      60_000,
      3,
    );

    await expect(resolver.resolveLatestRun()).resolves.toEqual(new Date("2026-08-18T18:00:00Z"));
  });

  it("caches a resolved cycle within the TTL", async () => {
    let now = Date.parse("2026-08-19T14:41:00Z");
    const isRunComplete = vi.fn(async (candidate: Date) => candidate.getUTCHours() === 6);
    const resolver = new LatestRunResolver({ isRunComplete }, () => now, 60_000, 4);

    const first = await resolver.resolveLatestRun();
    now += 30_000;
    const second = await resolver.resolveLatestRun();

    expect(first.toISOString()).toBe("2026-08-19T06:00:00.000Z");
    expect(second.toISOString()).toBe(first.toISOString());
    expect(isRunComplete).toHaveBeenCalledTimes(2);
  });

  it("rechecks after the TTL and can discover a newer complete cycle", async () => {
    let now = Date.parse("2026-08-19T14:41:00Z");
    let twelveComplete = false;
    const isRunComplete = vi.fn(async (candidate: Date) => {
      if (candidate.getUTCHours() === 12) return twelveComplete;
      return candidate.getUTCHours() === 6;
    });
    const resolver = new LatestRunResolver({ isRunComplete }, () => now, 60_000, 4);

    expect((await resolver.resolveLatestRun()).getUTCHours()).toBe(6);
    twelveComplete = true;
    now += 60_001;
    expect((await resolver.resolveLatestRun()).getUTCHours()).toBe(12);
  });

  it("returns defensive Date copies so callers cannot corrupt the cache", async () => {
    const isRunComplete = vi.fn(async () => true);
    const resolver = new LatestRunResolver(
      { isRunComplete },
      () => Date.parse("2026-08-19T14:41:00Z"),
      60_000,
      2,
    );

    const first = await resolver.resolveLatestRun();
    first.setUTCFullYear(2000);
    expect((await resolver.resolveLatestRun()).toISOString()).toBe("2026-08-19T12:00:00.000Z");
  });

  it("fails clearly when no complete run exists inside the lookback", async () => {
    const isRunComplete = vi.fn(async () => false);
    const resolver = new LatestRunResolver(
      { isRunComplete },
      () => Date.parse("2026-08-19T14:41:00Z"),
      60_000,
      3,
    );

    await expect(resolver.resolveLatestRun()).rejects.toThrow(/last 3 cycles/);
    expect(isRunComplete).toHaveBeenCalledTimes(3);
  });
});
