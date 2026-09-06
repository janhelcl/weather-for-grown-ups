import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VerificationIndexBackfillService } from "../src/core/verification-index-backfill.js";
import { VerificationIndexSkillService } from "../src/core/verification-index-skill.js";
import { VerificationIndexStore } from "../src/core/verification-index-store.js";
import {
  verificationIndexBackfillQuerySchema,
  verificationIndexSkillQuerySchema,
} from "../src/schema/verification-index.js";

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

  it("rejects duplicate selectors, unsupported variables, and duplicate month filters", () => {
    expect(() => verificationIndexBackfillQuerySchema.parse({
      referenceDataset: "gfs-analysis",
      latitude: 50, longitude: 14,
      startTime: "2020-01-02T00:00:00Z", endTime: "2020-01-01T00:00:00Z",
      cycleHoursUtc: [12, 12], leadHours: [24, 24],
      variables: ["not_a_variable"], pressureLevelsHpa: [850],
    })).toThrow();

    expect(() => verificationIndexSkillQuerySchema.parse({
      referenceDataset: "igra",
      latitude: 50, longitude: 14,
      startTime: "2020-01-01T00:00:00Z", endTime: "2020-01-02T00:00:00Z",
      cycleHoursUtc: [12], leadHours: [24],
      variables: ["vertical_velocity"], pressureLevelsHpa: [850],
      monthsUtc: [3, 3],
    })).toThrow();
  });
});

describe("VerificationIndexStore", () => {
  it("persists JSONL and suppresses repeated request identities", async () => {
    const store = await tempStore();
    const record = analysisRecord("2019-12-26T18:00:00.000Z", 54, 2);
    expect(await store.append([])).toBe(0);
    expect(await store.append([record as any])).toBe(1);
    expect(await store.append([record as any])).toBe(0);
    const all = await store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.result.pressureLevels[0]?.changes[0]?.delta).toBe(2);
  });

  it("reports malformed JSON and malformed records with corpus line numbers", async () => {
    const store = await tempStore();
    await writeFile(store.path, "not-json\n", "utf8");
    await expect(store.readAll()).rejects.toThrow(/evaluations\.jsonl:1/);

    await writeFile(store.path, '{"version":1}\n', "utf8");
    await expect(store.readAll()).rejects.toThrow(/Invalid verification index record/);
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

  it("routes IGRA controls and newest-first ordering into atomic verification", async () => {
    const stored: any[] = [];
    const store = {
      path: "/tmp/verification.jsonl",
      readAll: vi.fn(async () => stored),
      append: vi.fn(async (records: any[]) => { stored.push(...records); return records.length; }),
    };
    const verify = vi.fn(async (input: any) => ({
      validTime: new Date(input.validTime).toISOString(),
      leadHours: input.leadHours,
      gfsGrid: input.gfsGrid,
      station: { id: "EZM00011520" },
      pressureLevels: [],
    }));
    const service = new VerificationIndexBackfillService({
      store: store as any,
      igraVerifier: { verify } as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.backfill({
      referenceDataset: "igra",
      latitude: 50.08, longitude: 14.43,
      startTime: "2026-08-01T12:00:00Z", endTime: "2026-08-02T12:00:00Z",
      cycleHoursUtc: [12], leadHours: [24],
      variables: ["temperature"], pressureLevelsHpa: [850],
      stationId: "EZM00011520", gfsGrid: "0p25", maxStationDistanceKm: 100,
      order: "newest_first",
      maxFetches: 1,
    } as any);

    expect(result.status).toBe("budget_exhausted");
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2026-08-02T12:00:00.000Z",
      stationId: "EZM00011520",
      gfsGrid: "0p25",
      maxStationDistanceKm: 100,
    }));
    expect(stored[0]?.request).toMatchObject({
      stationId: "EZM00011520",
      gfsGrid: "0p25",
      maxStationDistanceKm: 100,
    });
  });

  it("uses IGRA default grid/station controls when none are requested", async () => {
    const stored: any[] = [];
    const store = {
      path: "/tmp/verification.jsonl",
      readAll: vi.fn(async () => stored),
      append: vi.fn(async (records: any[]) => { stored.push(...records); return records.length; }),
    };
    const verify = vi.fn(async (input: any) => ({
      validTime: new Date(input.validTime).toISOString(),
      leadHours: input.leadHours,
      gfsGrid: "0p25",
      station: { id: "EZM00011520" },
      pressureLevels: [],
    }));
    const service = new VerificationIndexBackfillService({
      store: store as any,
      igraVerifier: { verify } as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.backfill({
      referenceDataset: "igra",
      latitude: 50.08, longitude: 14.43,
      startTime: "2026-08-01T12:00:00Z", endTime: "2026-08-01T12:00:00Z",
      cycleHoursUtc: [12], leadHours: [24],
      variables: ["temperature"], pressureLevelsHpa: [850],
      maxFetches: 1,
    });

    expect(result.status).toBe("complete");
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      maxStationDistanceKm: 250,
    }));
    expect(verify.mock.calls[0]?.[0]).not.toHaveProperty("stationId");
    expect(verify.mock.calls[0]?.[0]).not.toHaveProperty("gfsGrid");
    expect(stored[0]?.request).toEqual(expect.objectContaining({
      maxStationDistanceKm: 250,
    }));
    expect(stored[0]?.request).not.toHaveProperty("stationId");
    expect(stored[0]?.request).not.toHaveProperty("gfsGrid");
  });

  it("reports stopped and continuing error states explicitly", async () => {
    const makeService = (continueMode: boolean) => {
      const stored: any[] = [];
      const store = {
        path: "/tmp/verification.jsonl",
        readAll: vi.fn(async () => stored),
        append: vi.fn(async (records: any[]) => { stored.push(...records); return records.length; }),
      };
      const verify = vi.fn(async (input: any) => {
        if (input.leadHours === 48) throw new Error("archive gap");
        return analysisResult(input.validTime, input.leadHours, 1);
      });
      return {
        service: new VerificationIndexBackfillService({
          store: store as any,
          analysisVerifier: { verify } as any,
          now: () => new Date("2026-08-27T00:00:00Z"),
        }),
        continueMode,
      };
    };
    const base = {
      referenceDataset: "gfs-analysis" as const,
      latitude: 50, longitude: 14,
      startTime: "2020-01-01T12:00:00Z", endTime: "2020-01-01T12:00:00Z",
      cycleHoursUtc: [12] as const, leadHours: [24, 48],
      variables: ["temperature"], pressureLevelsHpa: [850], maxFetches: 4,
    };

    const stopped = makeService(false);
    const stoppedResult = await stopped.service.backfill({ ...base, continueOnError: false });
    expect(stoppedResult.status).toBe("stopped_on_error");
    expect(stoppedResult.failures[0]?.message).toBe("archive gap");

    const continuing = makeService(true);
    const continuingResult = await continuing.service.backfill({ ...base, continueOnError: true });
    expect(continuingResult.status).toBe("errors_remaining");
    expect(continuingResult.materialized).toBe(1);
    expect(continuingResult.remaining).toBe(1);
  });

  it("rejects future, empty-cycle, and oversized verification plans before fetching", async () => {
    const verify = vi.fn();
    const store = { path: "/tmp/verification.jsonl", readAll: vi.fn(async () => []), append: vi.fn() };
    const service = new VerificationIndexBackfillService({
      store: store as any, analysisVerifier: { verify } as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    await expect(service.backfill({
      referenceDataset: "gfs-analysis",
      latitude: 50, longitude: 14,
      startTime: "2026-08-27T00:00:00Z", endTime: "2026-08-28T00:00:00Z",
      cycleHoursUtc: [12], leadHours: [24],
      variables: ["temperature"], pressureLevelsHpa: [850],
    })).rejects.toThrow(/must not be in the future/);

    await expect(service.backfill({
      referenceDataset: "gfs-analysis",
      latitude: 50, longitude: 14,
      startTime: "2020-01-01T01:00:00Z", endTime: "2020-01-01T05:00:00Z",
      cycleHoursUtc: [12], leadHours: [24],
      variables: ["temperature"], pressureLevelsHpa: [850],
    })).rejects.toThrow(/contains no selected verification times/);

    const allLeads = Array.from({ length: 33 }, (_, index) => index * 6);
    await expect(service.backfill({
      referenceDataset: "gfs-analysis",
      latitude: 50, longitude: 14,
      startTime: "2000-01-01T00:00:00Z", endTime: "2026-08-26T18:00:00Z",
      cycleHoursUtc: [0, 6, 12, 18], leadHours: allLeads,
      variables: ["temperature"], pressureLevelsHpa: [850],
    })).rejects.toThrow(/exceeding the planning limit/);
    expect(verify).not.toHaveBeenCalled();
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

  it("filters IGRA corpus cases by actual station, grid, distance, lead, and point", async () => {
    const good = igraRecord("2026-08-01T12:00:00.000Z", 24, 2, undefined) as any;
    const otherLead = igraRecord("2026-08-01T12:00:00.000Z", 48, 9, undefined) as any;
    const tooFar = igraRecord("2026-08-02T12:00:00.000Z", 24, 9, undefined) as any;
    tooFar.result.station.distanceKm = 120;
    const wrongGrid = igraRecord("2026-08-03T12:00:00.000Z", 24, 9, undefined) as any;
    wrongGrid.result.gfsGrid = "0p50";
    const wrongStation = igraRecord("2026-08-04T12:00:00.000Z", 24, 9, undefined) as any;
    wrongStation.result.station.id = "GMM00010393";
    wrongStation.result.station.name = "OTHER";
    const wrongPoint = igraRecord("2026-08-05T12:00:00.000Z", 24, 9, undefined) as any;
    wrongPoint.request.requestedPoint.longitude = 15;

    const store = {
      path: "/tmp/verification.jsonl",
      readAll: vi.fn(async () => [good, otherLead, tooFar, wrongGrid, wrongStation, wrongPoint]),
    };
    const service = new VerificationIndexSkillService({ store: store as any });
    const result = await service.summarize({
      referenceDataset: "igra",
      latitude: 50.08, longitude: 14.43,
      startTime: "2026-08-01T00:00:00Z", endTime: "2026-08-05T23:59:59Z",
      cycleHoursUtc: [12], leadHours: [24],
      variables: ["temperature"], pressureLevelsHpa: [850],
      stationId: "EZM00011520", gfsGrid: "0p25", maxStationDistanceKm: 100,
    });

    expect(result.coverage.materializedEvaluations).toBe(1);
    expect(result.statistics[0]).toMatchObject({ count: 1, bias: 2 });
  });

  it("orders same-time materialized cases by lead before aggregation", async () => {
    const records = [
      analysisRecord("2020-03-01T12:00:00.000Z", 48, 2),
      analysisRecord("2020-03-01T12:00:00.000Z", 24, 1),
    ];
    const store = { path: "/tmp/verification.jsonl", readAll: vi.fn(async () => records as any[]) };
    const service = new VerificationIndexSkillService({ store: store as any });
    const result = await service.summarize({
      referenceDataset: "gfs-analysis",
      latitude: 50.08, longitude: 14.43,
      startTime: "2020-03-01T12:00:00Z", endTime: "2020-03-01T12:00:00Z",
      cycleHoursUtc: [12], leadHours: [48, 24],
      variables: ["temperature"], pressureLevelsHpa: [850],
    });
    expect(result.statistics.map((item) => item.leadHours)).toEqual([24, 48]);
    expect(result.coverage.materializedEvaluations).toBe(2);
  });

  it("returns explicit zero coverage when a requested period has no eligible cycle", async () => {
    const store = { path: "/tmp/verification.jsonl", readAll: vi.fn(async () => []) };
    const service = new VerificationIndexSkillService({ store: store as any });
    const result = await service.summarize({
      referenceDataset: "gfs-analysis",
      latitude: 50, longitude: 14,
      startTime: "2020-01-01T01:00:00Z", endTime: "2020-01-01T05:00:00Z",
      cycleHoursUtc: [12], leadHours: [24],
      variables: ["temperature"], pressureLevelsHpa: [850],
    });
    expect(result.period.expectedEvaluations).toBe(0);
    expect(result.coverage).toEqual({
      materializedEvaluations: 0,
      missingEvaluations: 0,
      coverageRate: 0,
    });
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
      forecast: { provider: "NOAA NCEI", access: "ncei_thredds_ncss", dataset: "forecast.grb2" },
      reference: { provider: "NOAA NCEI", access: "ncei_thredds_ncss", dataset: "analysis.grb2" },
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
