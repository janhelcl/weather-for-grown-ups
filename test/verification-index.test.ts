import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VerificationIndexBackfillService } from "../src/core/verification-index-backfill.js";
import { VerificationIndexSkillService } from "../src/core/verification-index-skill.js";
import { VerificationIndexStore } from "../src/core/verification-index-store.js";
import { verificationIndexBackfillQuerySchema } from "../src/schema/verification-index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), "wfg-verification-index-"));
  tempDirs.push(dir);
  return new VerificationIndexStore({ path: join(dir, "evaluations.jsonl") });
}

describe("verification corpus schema", () => {
  it("accepts multi-year backfill planning while preserving reference-specific controls", () => {
    const query = verificationIndexBackfillQuerySchema.parse({
      referenceDataset: "igra",
      latitude: 50.08, longitude: 14.43,
      startTime: "2020-01-01T00:00:00Z", endTime: "2025-12-31T23:59:59Z",
      cycleHoursUtc: [12],
      leadHours: [24, 48, 72],
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850, 700],
      stationId: "EZM00011520",
      gfsGrid: "0p25",
    });
    expect(query.leadHours).toEqual([24, 48, 72]);

    expect(() => verificationIndexBackfillQuerySchema.parse({
      referenceDataset: "gfs-analysis",
      latitude: 50, longitude: 14,
      startTime: "2020-01-01T00:00:00Z", endTime: "2020-01-02T00:00:00Z",
      leadHours: [24], variables: ["temperature"], pressureLevelsHpa: [850],
      stationId: "EZM00011520",
    })).toThrow(/only valid when referenceDataset=igra/);
  });
});

describe("VerificationIndexStore", () => {
  it("persists JSONL and suppresses repeated request identities", async () => {
    const store = await tempStore();
    const record = analysisRecord("2019-12-26T18:00:00.000Z", 54, 2);
    expect(await store.append([record as any])).toBe(1);
    expect(await store.append([record as any])).toBe(0);
    const all = await store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.result.pressureLevels[0]?.changes[0]?.delta).toBe(2);
  });
});

describe("VerificationIndexBackfillService", () => {
  it("skips materialized cases, respects fetch budget, and resumes", async () => {
    const existing = [analysisRecord("2019-12-26T12:00:00.000Z", 24, 1) as any];
    const stored = [...existing];
    const store = {
      path: "/tmp/verification.jsonl",
      readAll: vi.fn(async () => stored),
      append: vi.fn(async (records: any[]) => { stored.push(...records); return records.length; }),
    };
    const verify = vi.fn(async (input: any) =>
      analysisResult(input.validTime, input.leadHours, input.leadHours === 24 ? 1 : 2));
    const service = new VerificationIndexBackfillService({
      store: store as any,
      analysisVerifier: { verify } as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });
    const input = {
      referenceDataset: "gfs-analysis" as const,
      latitude: 50.08, longitude: 14.43,
      startTime: "2019-12-26T12:00:00Z", endTime: "2019-12-26T18:00:00Z",
      cycleHoursUtc: [12, 18] as const,
      leadHours: [24, 48],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    };

    const first = await service.backfill({ ...input, maxFetches: 2 });
    expect(first).toMatchObject({
      selectedValidTimes: 2,
      selectedEvaluations: 4,
      alreadyMaterialized: 1,
      attempted: 2,
      materialized: 2,
      remaining: 1,
      status: "budget_exhausted",
    });
    expect(verify).toHaveBeenCalledTimes(2);

    const second = await service.backfill({ ...input, maxFetches: 2 });
    expect(second.status).toBe("complete");
    expect(second.alreadyMaterialized).toBe(3);
    expect(second.attempted).toBe(1);
    expect(second.remaining).toBe(0);
  });

  it("dry-runs a large plan without verification work", async () => {
    const verify = vi.fn();
    const store = { path: "/tmp/verification.jsonl", readAll: vi.fn(async () => []), append: vi.fn() };
    const service = new VerificationIndexBackfillService({
      store: store as any, analysisVerifier: { verify } as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });
    const result = await service.backfill({
      referenceDataset: "gfs-analysis",
      latitude: 50, longitude: 14,
      startTime: "2020-01-01T00:00:00Z", endTime: "2020-12-31T23:59:59Z",
      cycleHoursUtc: [12], leadHours: [24, 48, 72],
      variables: ["temperature"], pressureLevelsHpa: [850], dryRun: true,
    });
    expect(result.status).toBe("dry_run");
    expect(result.selectedEvaluations).toBe(366 * 3);
    expect(result.attempted).toBe(0);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("VerificationIndexSkillService", () => {
  it("aggregates multi-year seasonal skill locally and reports corpus coverage", async () => {
    const records = [
      analysisRecord("2020-03-01T12:00:00.000Z", 24, 1),
      analysisRecord("2021-03-01T12:00:00.000Z", 24, 3),
      analysisRecord("2020-07-01T12:00:00.000Z", 24, 100),
    ];
    const store = { path: "/tmp/verification.jsonl", readAll: vi.fn(async () => records as any[]) };
    const service = new VerificationIndexSkillService({ store: store as any });

    const result = await service.summarize({
      referenceDataset: "gfs-analysis",
      latitude: 50.08, longitude: 14.43,
      startTime: "2020-01-01T00:00:00Z", endTime: "2021-12-31T23:59:59Z",
      cycleHoursUtc: [12], monthsUtc: [3], leadHours: [24],
      variables: ["temperature"], pressureLevelsHpa: [850],
    });

    expect(result.source).toEqual({ access: "local_jsonl", upstreamRequests: 0 });
    expect(result.period.eligibleValidTimes).toBe(62);
    expect(result.coverage.materializedEvaluations).toBe(2);
    expect(result.coverage.missingEvaluations).toBe(60);
    expect(result.statistics).toEqual([
      expect.objectContaining({
        leadHours: 24, pressureHpa: 850, field: "temperatureC",
        count: 2, bias: 2, mae: 2, rmse: Math.sqrt(5),
      }),
    ]);
  });

  it("deduplicates the same actual IGRA case across different request modes", async () => {
    const first = igraRecord("2026-08-01T12:00:00.000Z", 24, 1, undefined);
    const second = igraRecord("2026-08-01T12:00:00.000Z", 24, 1, "EZM00011520");
    const store = { path: "/tmp/verification.jsonl", readAll: vi.fn(async () => [first, second] as any[]) };
    const service = new VerificationIndexSkillService({ store: store as any });
    const result = await service.summarize({
      referenceDataset: "igra",
      latitude: 50.08, longitude: 14.43,
      startTime: "2026-08-01T12:00:00Z", endTime: "2026-08-01T12:00:00Z",
      cycleHoursUtc: [12], leadHours: [24],
      variables: ["temperature"], pressureLevelsHpa: [850],
    });
    expect(result.coverage.materializedEvaluations).toBe(1);
    expect(result.statistics[0]?.count).toBe(1);
    expect(result.stations?.map((station) => station.id)).toEqual(["EZM00011520"]);
  });
});

function analysisRecord(validTime: string, leadHours: number, delta: number) {
  return {
    version: 1,
    referenceDataset: "gfs-analysis",
    request: {
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      validTime, leadHours, variables: ["temperature"], pressureLevelsHpa: [850],
    },
    result: analysisResult(validTime, leadHours, delta),
  };
}

function analysisResult(validTime: string, leadHours: number, delta: number) {
  const forecastRun = new Date(new Date(validTime).getTime() - leadHours * 3_600_000).toISOString();
  return {
    model: "gfs_grid4_archive_verification_0p5",
    validTime, leadHours, forecastRun,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    comparison: "analysis_minus_forecast",
    forecast: {
      model: "gfs_grid4_forecast_0p5_archive", runTime: forecastRun, forecastHour: leadHours, validTime,
      levels: [{ pressureHpa: 850, temperatureC: 10 }], dataset: "forecast.grb2", cacheHit: true,
    },
    analysis: {
      model: "gfs_grid4_analysis_0p5", analysisTime: validTime,
      levels: [{ pressureHpa: 850, temperatureC: 10 + delta }], dataset: "analysis.grb2", cacheHit: true,
    },
    pressureLevels: [{
      pressureHpa: 850,
      changes: [{ field: "temperatureC", forecast: 10, analysis: 10 + delta, delta, deltaKind: "linear" }],
    }],
    source: {
      provider: "NOAA NCEI", access: "ncei_thredds_ncss",
      forecastArchiveAvailability: "online availability varies; older forecast data may require NCEI HAS",
    },
    caveat: "Forecast verification against GFS model analysis, not direct observations; historical GFS model versions changed over time",
  };
}

function igraRecord(validTime: string, leadHours: number, delta: number, stationId: string | undefined) {
  return {
    version: 1,
    referenceDataset: "igra",
    request: {
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      validTime, leadHours, variables: ["temperature"], pressureLevelsHpa: [850],
      ...(stationId === undefined ? {} : { stationId }),
      maxStationDistanceKm: 250,
    },
    result: {
      validTime, leadHours, gfsGrid: "0p25",
      station: {
        id: "EZM00011520", name: "PRAHA-LIBUS", latitude: 50.0078, longitude: 14.4469,
        elevationM: 302, distanceKm: 8,
      },
      pressureLevels: [{
        pressureHpa: 850,
        changes: [{ field: "temperatureC", forecast: 10, observation: 10 + delta, delta, deltaKind: "linear" }],
      }],
    },
  };
}
