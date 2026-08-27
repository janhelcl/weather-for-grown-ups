import { describe, expect, it, vi } from "vitest";
import { expandRequestedFields } from "../src/catalog/non-isobaric-fields.js";
import {
  DEFAULT_LATEST_RUN_LOOKBACK_CYCLES,
  DEFAULT_LATEST_RUN_TTL_MS,
  floorToGfsCycle,
  LatestRunResolver,
  type LatestRunRequirement,
} from "../src/core/latest-run.js";
import type { RunAvailabilityProbe } from "../src/sources/gfs-s3.js";

const pressureSelection = {
  variableCodes: ["TMP"],
  pressureLevelsHpa: [850],
  fields: [],
};

function probe(overrides: Partial<RunAvailabilityProbe> = {}): RunAvailabilityProbe {
  return {
    isRunComplete: async () => true,
    isForecastAvailable: async () => true,
    ...overrides,
  };
}

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

describe("LatestRunResolver complete-run mode", () => {
  it("keeps conservative defaults for lookback and cache freshness", () => {
    expect(DEFAULT_LATEST_RUN_LOOKBACK_CYCLES).toBe(8);
    expect(DEFAULT_LATEST_RUN_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("walks backward from the current cycle until it finds a complete run", async () => {
    const isRunComplete = vi.fn(async (candidate: Date) => candidate.getUTCHours() === 6);
    const resolver = new LatestRunResolver(
      probe({ isRunComplete }),
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

  it("caches a resolved cycle within the TTL", async () => {
    let now = Date.parse("2026-08-19T14:41:00Z");
    const isRunComplete = vi.fn(async (candidate: Date) => candidate.getUTCHours() === 6);
    const resolver = new LatestRunResolver(probe({ isRunComplete }), () => now, 60_000, 4);

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
    const resolver = new LatestRunResolver(probe({ isRunComplete }), () => now, 60_000, 4);

    expect((await resolver.resolveLatestRun()).getUTCHours()).toBe(6);
    twelveComplete = true;
    now += 60_001;
    expect((await resolver.resolveLatestRun()).getUTCHours()).toBe(12);
  });

  it("returns defensive Date copies so callers cannot corrupt the cache", async () => {
    const resolver = new LatestRunResolver(
      probe(),
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
      probe({ isRunComplete }),
      () => Date.parse("2026-08-19T14:41:00Z"),
      60_000,
      3,
    );

    await expect(resolver.resolveLatestRun()).rejects.toThrow(/last 3 cycles/);
    expect(isRunComplete).toHaveBeenCalledTimes(3);
  });
});

describe("LatestRunResolver 0.5 grid routing", () => {
  it("passes 0.5 to complete-run probes", async () => {
    const isRunComplete = vi.fn(async () => true);
    const resolver = new LatestRunResolver(
      probe({ isRunComplete }),
      () => Date.parse("2026-08-19T14:41:00Z"),
    );
    await resolver.resolveLatestRun(undefined, "0p50");
    expect(isRunComplete).toHaveBeenCalledWith(
      new Date("2026-08-19T12:00:00Z"),
      "0p50",
    );
  });

  it("passes 0.5 to valid-time availability probes", async () => {
    const isForecastAvailable = vi.fn(async () => true);
    const resolver = new LatestRunResolver(
      probe({ isForecastAvailable }),
      () => Date.parse("2026-08-19T14:41:00Z"),
    );
    await resolver.resolveLatestRun({
      type: "valid_time",
      validTime: new Date("2026-08-19T18:00:00Z"),
      selection: pressureSelection,
    }, "0p50");
    expect(isForecastAvailable).toHaveBeenCalledWith(
      new Date("2026-08-19T12:00:00Z"),
      6,
      pressureSelection,
      "0p50",
    );
  });

  it("checks first and last 0.5 native steps for a range", async () => {
    const isForecastAvailable = vi.fn(async () => true);
    const resolver = new LatestRunResolver(
      probe({ isForecastAvailable }),
      () => Date.parse("2026-08-19T14:41:00Z"),
    );
    await resolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-08-19T12:00:00Z"),
      endTime: new Date("2026-08-19T18:00:00Z"),
      selection: pressureSelection,
    }, "0p50");
    expect(isForecastAvailable.mock.calls.map(([candidate, fh, selection, grid]) => [
      candidate.toISOString(), fh, selection, grid,
    ])).toEqual([
      ["2026-08-19T12:00:00.000Z", 0, pressureSelection, "0p50"],
      ["2026-08-19T12:00:00.000Z", 6, pressureSelection, "0p50"],
    ]);
  });
});

describe("LatestRunResolver query-aware mode", () => {
  it("selects the newest cycle whose requested forecast is actually published", async () => {
    const isForecastAvailable = vi.fn(async (candidate: Date, fh: number) =>
      candidate.toISOString() === "2026-08-19T06:00:00.000Z" && fh === 12,
    );
    const resolver = new LatestRunResolver(
      probe({ isForecastAvailable }),
      () => Date.parse("2026-08-19T14:41:00Z"),
      60_000,
      4,
    );
    const requirement: LatestRunRequirement = {
      type: "valid_time",
      validTime: new Date("2026-08-19T18:00:00Z"),
      selection: pressureSelection,
    };

    await expect(resolver.resolveLatestRun(requirement)).resolves.toEqual(new Date("2026-08-19T06:00:00Z"));
    expect(isForecastAvailable.mock.calls.map(([candidate, fh]) => [candidate.toISOString(), fh])).toEqual([
      ["2026-08-19T12:00:00.000Z", 6],
      ["2026-08-19T06:00:00.000Z", 12],
    ]);
  });

  it("never chooses a run initialized after the requested valid time", async () => {
    const isForecastAvailable = vi.fn(async () => true);
    const resolver = new LatestRunResolver(
      probe({ isForecastAvailable }),
      () => Date.parse("2026-08-19T14:41:00Z"),
    );

    const result = await resolver.resolveLatestRun({
      type: "valid_time",
      validTime: new Date("2026-08-19T09:00:00Z"),
      selection: pressureSelection,
    });
    expect(result.toISOString()).toBe("2026-08-19T06:00:00.000Z");
    expect(isForecastAvailable).toHaveBeenCalledWith(
      new Date("2026-08-19T06:00:00Z"),
      3,
      pressureSelection,
    );
  });

  it("passes exact named-layer temporal requirements to the availability probe", async () => {
    const fields = expandRequestedFields(["low_cloud_cover_average"]);
    const isForecastAvailable = vi.fn(async (_candidate: Date, _fh: number, selection) =>
      selection.fields.some((field) => field.id === "low_cloud_cover_average"),
    );
    const resolver = new LatestRunResolver(probe({ isForecastAvailable }), () => Date.parse("2026-08-19T14:41:00Z"));

    await resolver.resolveLatestRun({
      type: "valid_time",
      validTime: new Date("2026-08-19T12:00:00Z"),
      selection: { variableCodes: [], pressureLevelsHpa: [], fields },
    });
    expect(isForecastAvailable).toHaveBeenCalledWith(
      new Date("2026-08-19T12:00:00Z"),
      0,
      expect.objectContaining({ fields }),
    );
  });

  it("for a time range chooses a run at or before the requested start and checks first and last native steps", async () => {
    const calls: Array<[string, number]> = [];
    const isForecastAvailable = vi.fn(async (candidate: Date, fh: number) => {
      calls.push([candidate.toISOString(), fh]);
      // f000 is deliberately unavailable for the newest eligible cycle.
      return !(candidate.toISOString() === "2026-08-19T12:00:00.000Z" && fh === 0);
    });
    const resolver = new LatestRunResolver(
      probe({ isForecastAvailable }),
      () => Date.parse("2026-08-19T14:41:00Z"),
      60_000,
      4,
    );

    const result = await resolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-08-19T12:00:00Z"),
      endTime: new Date("2026-08-19T18:00:00Z"),
      selection: pressureSelection,
    });

    expect(result.toISOString()).toBe("2026-08-19T06:00:00.000Z");
    expect(calls).toEqual([
      ["2026-08-19T12:00:00.000Z", 0],
      ["2026-08-19T06:00:00.000Z", 6],
      ["2026-08-19T06:00:00.000Z", 12],
    ]);
  });

  it("rejects a time range that cannot fit inside the 384-hour horizon", async () => {
    const resolver = new LatestRunResolver(probe(), () => Date.parse("2026-08-19T14:41:00Z"));
    await expect(resolver.resolveLatestRun({
      type: "time_range",
      startTime: new Date("2026-08-19T12:00:00Z"),
      endTime: new Date("2026-09-05T00:00:00Z"),
      selection: pressureSelection,
    })).rejects.toThrow(/384-hour GFS horizon/);
  });

  it("caches different query requirements independently", async () => {
    const isForecastAvailable = vi.fn(async () => true);
    const resolver = new LatestRunResolver(probe({ isForecastAvailable }), () => Date.parse("2026-08-19T14:41:00Z"));

    const first: LatestRunRequirement = {
      type: "valid_time",
      validTime: new Date("2026-08-19T18:00:00Z"),
      selection: pressureSelection,
    };
    const second: LatestRunRequirement = {
      type: "valid_time",
      validTime: new Date("2026-08-19T19:00:00Z"),
      selection: pressureSelection,
    };
    await resolver.resolveLatestRun(first);
    await resolver.resolveLatestRun(first);
    await resolver.resolveLatestRun(second);
    expect(isForecastAvailable).toHaveBeenCalledTimes(2);
  });
});
