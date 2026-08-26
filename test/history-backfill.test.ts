import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoricalIndexBackfillService, nearestGfsGrid4Point } from "../src/core/history-backfill.js";
import { HistoricalProfileIndexStore } from "../src/core/history-index-store.js";
import type { HistoricalProfileResult } from "../src/schema/history-result.js";
import type { HistoricalIndexRecord } from "../src/schema/history-index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), "wfg-history-backfill-"));
  tempDirs.push(dir);
  return new HistoricalProfileIndexStore({ path: join(dir, "profiles.jsonl") });
}

function indexedRecord(analysisTime: string): HistoricalIndexRecord {
  return {
    version: 1,
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    levels: [{ pressureHpa: 850, temperatureC: 10 }],
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: `archive/${analysisTime}.grb2`,
    },
  };
}

function profile(analysisTime: string, cacheHit = false): HistoricalProfileResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    levels: [{ pressureHpa: 850, temperatureC: 10 }],
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: `archive/${analysisTime}.grb2`,
      cacheHit,
    },
    caveat: "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
  };
}

const baseInput = {
  latitude: 50.08,
  longitude: 14.43,
  startTime: "2017-05-01T00:00:00Z",
  endTime: "2017-05-04T23:59:59Z",
  cycleHoursUtc: [12] as const,
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
};

describe("HistoricalIndexBackfillService", () => {
  it("skips materialized cycles, respects the fetch budget and resumes idempotently", async () => {
    const store = await tempStore();
    await store.append([indexedRecord("2017-05-01T12:00:00.000Z")]);
    const getHistoricalProfile = vi.fn(async (input: { analysisTime: string }) =>
      profile(input.analysisTime, input.analysisTime.includes("03T12")));
    const service = new HistoricalIndexBackfillService({
      store,
      profileGetter: { getHistoricalProfile } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });

    const first = await service.backfill({ ...baseInput, maxFetches: 2 });
    expect(first).toMatchObject({
      status: "budget_exhausted",
      selectedCycleCount: 4,
      alreadyMaterialized: 1,
      fetchBudget: 2,
      attempted: 2,
      materialized: 2,
      upstreamFetches: 1,
      cacheHits: 1,
      remaining: 1,
      nextAnalysisTime: "2017-05-04T12:00:00.000Z",
    });
    expect(getHistoricalProfile.mock.calls.map(([input]) => input.analysisTime)).toEqual([
      "2017-05-02T12:00:00.000Z",
      "2017-05-03T12:00:00.000Z",
    ]);

    const second = await service.backfill({ ...baseInput, maxFetches: 2 });
    expect(second.status).toBe("complete");
    expect(second.alreadyMaterialized).toBe(3);
    expect(second.attempted).toBe(1);
    expect(second.materialized).toBe(1);
    expect(second.remaining).toBe(0);
    expect(second.nextAnalysisTime).toBeNull();
    expect((await store.readAll())).toHaveLength(4);
  });

  it("plans large ranges without touching the archive in dry-run mode", async () => {
    const store = await tempStore();
    const getHistoricalProfile = vi.fn();
    const service = new HistoricalIndexBackfillService({
      store,
      profileGetter: { getHistoricalProfile } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    const result = await service.backfill({ ...baseInput, dryRun: true, maxFetches: 1 });
    expect(result.status).toBe("dry_run");
    expect(result.selectedCycleCount).toBe(4);
    expect(result.remaining).toBe(4);
    expect(result.attempted).toBe(0);
    expect(getHistoricalProfile).not.toHaveBeenCalled();
  });

  it("stops on the first error by default but persists earlier successes", async () => {
    const store = await tempStore();
    const getHistoricalProfile = vi.fn(async (input: { analysisTime: string }) => {
      if (input.analysisTime.includes("02T12")) throw new Error("archive gap");
      return profile(input.analysisTime);
    });
    const service = new HistoricalIndexBackfillService({
      store,
      profileGetter: { getHistoricalProfile } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    const result = await service.backfill({ ...baseInput, maxFetches: 4 });
    expect(result.status).toBe("stopped_on_error");
    expect(result.attempted).toBe(2);
    expect(result.materialized).toBe(1);
    expect(result.failures).toEqual([{ analysisTime: "2017-05-02T12:00:00.000Z", message: "archive gap" }]);
    expect(await store.readAll()).toHaveLength(1);
  });

  it("can continue after isolated archive errors and reports unresolved cycles", async () => {
    const store = await tempStore();
    const getHistoricalProfile = vi.fn(async (input: { analysisTime: string }) => {
      if (input.analysisTime.includes("02T12")) throw new Error("missing source file");
      return profile(input.analysisTime);
    });
    const service = new HistoricalIndexBackfillService({
      store,
      profileGetter: { getHistoricalProfile } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    const result = await service.backfill({
      ...baseInput,
      endTime: "2017-05-03T23:59:59Z",
      maxFetches: 3,
      continueOnError: true,
    });
    expect(result.status).toBe("budget_exhausted");
    expect(result.attempted).toBe(3);
    expect(result.materialized).toBe(2);
    expect(result.remaining).toBe(1);
    expect(result.nextAnalysisTime).toBe("2017-05-02T12:00:00.000Z");
  });

  it("supports newest-first backfill order", async () => {
    const store = await tempStore();
    const getHistoricalProfile = vi.fn(async (input: { analysisTime: string }) => profile(input.analysisTime));
    const service = new HistoricalIndexBackfillService({
      store,
      profileGetter: { getHistoricalProfile } as never,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    const result = await service.backfill({ ...baseInput, maxFetches: 1, order: "newest_first" });
    expect(getHistoricalProfile.mock.calls[0]?.[0].analysisTime).toBe("2017-05-04T12:00:00.000Z");
    expect(result.nextAnalysisTime).toBe("2017-05-03T12:00:00.000Z");
  });

  it("rejects pre-archive and future ranges before fetching", async () => {
    const service = new HistoricalIndexBackfillService({ now: () => new Date("2020-01-01T00:00:00Z") });
    await expect(service.backfill({
      ...baseInput,
      startTime: "2006-12-31T12:00:00Z",
      endTime: "2007-01-02T12:00:00Z",
    })).rejects.toThrow(/begins at 2007/);
    await expect(service.backfill({
      ...baseInput,
      startTime: "2019-12-31T12:00:00Z",
      endTime: "2020-01-02T12:00:00Z",
    })).rejects.toThrow(/must not be in the future/);
  });
});

describe("nearestGfsGrid4Point", () => {
  it("normalizes coordinates onto the 0.5 degree Grid 4 lattice", () => {
    expect(nearestGfsGrid4Point(50.08, 14.43)).toEqual({ latitude: 50, longitude: 14.5 });
    expect(nearestGfsGrid4Point(-33.86, 359.8)).toEqual({ latitude: -34, longitude: 0 });
    expect(nearestGfsGrid4Point(90, -179.76)).toEqual({ latitude: 90, longitude: -180 });
  });
});
