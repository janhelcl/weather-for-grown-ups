import { describe, expect, it, vi } from "vitest";
import { HistoricalForecastSkillService } from "../src/core/history-skill.js";

describe("HistoricalForecastSkillService", () => {
  it("aggregates analysis-minus-forecast skill by lead, pressure and field", async () => {
    const verifier = {
      verify: vi.fn(async (input: any) => {
        const day = new Date(input.validTime).getUTCDate();
        const delta = input.leadHours === 24 ? (day === 1 ? 1 : 3) : -2;
        return atomicResult(input, delta);
      }),
    };
    const service = new HistoricalForecastSkillService({
      verifier: verifier as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.summarize({
      latitude: 50,
      longitude: 14,
      startTime: "2026-08-01T12:00:00Z",
      endTime: "2026-08-02T12:00:00Z",
      cycleHoursUtc: [12],
      leadHours: [24, 48],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });

    expect(verifier.verify).toHaveBeenCalledTimes(4);
    expect(result.comparison).toBe("analysis_minus_forecast");
    expect(result.source).toMatchObject({ referenceDataset: "gfs-analysis", grid: "0p50" });
    expect(result.availability).toEqual({
      requestedEvaluations: 4,
      successfulEvaluations: 4,
      failedEvaluations: 0,
      successRate: 1,
    });
    expect(result.statistics).toEqual([
      expect.objectContaining({ leadHours: 24, pressureHpa: 850, field: "temperatureC", count: 2, bias: 2, mae: 2 }),
      expect.objectContaining({ leadHours: 48, pressureHpa: 850, field: "temperatureC", count: 2, bias: -2, mae: 2, rmse: 2 }),
    ]);
  });

  it("retains failed evaluations without contaminating statistics", async () => {
    const verifier = {
      verify: vi.fn(async (input: any) => {
        if (input.leadHours === 48) throw new Error("archive file unavailable");
        return atomicResult(input, 1);
      }),
    };
    const service = new HistoricalForecastSkillService({
      verifier: verifier as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.summarize({
      latitude: 50,
      longitude: 14,
      startTime: "2026-08-01T12:00:00Z",
      endTime: "2026-08-01T12:00:00Z",
      cycleHoursUtc: [12],
      leadHours: [24, 48],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });

    expect(result.availability).toEqual({
      requestedEvaluations: 2,
      successfulEvaluations: 1,
      failedEvaluations: 1,
      successRate: 0.5,
    });
    expect(result.evaluations[1]).toMatchObject({ status: "failed", leadHours: 48, error: "archive file unavailable" });
    expect(result.statistics).toHaveLength(1);
    expect(result.statistics[0]).toMatchObject({ leadHours: 24, count: 1, bias: 1 });
  });

  it("samples dense periods deterministically and enforces date bounds", async () => {
    const verifier = { verify: vi.fn(async (input: any) => atomicResult(input, 0)) };
    const service = new HistoricalForecastSkillService({
      verifier: verifier as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.summarize({
      latitude: 50,
      longitude: 14,
      startTime: "2026-08-01T00:00:00Z",
      endTime: "2026-08-10T18:00:00Z",
      cycleHoursUtc: [0, 6, 12, 18],
      leadHours: [24],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxValidTimes: 3,
    });
    expect(result.period.eligibleValidTimes).toBe(40);
    expect(result.period.sampledValidTimes).toHaveLength(3);
    expect(result.period.truncated).toBe(true);

    await expect(service.summarize({
      latitude: 50, longitude: 14,
      startTime: "2026-08-01T00:00:00Z", endTime: "2026-08-28T00:00:00Z",
      leadHours: [24], variables: ["temperature"], pressureLevelsHpa: [850],
    })).rejects.toThrow(/must not be in the future/);
  });
});

function atomicResult(input: any, delta: number) {
  const validTime = new Date(input.validTime).toISOString();
  const forecastRun = new Date(new Date(input.validTime).getTime() - input.leadHours * 3_600_000).toISOString();
  return {
    model: "gfs_grid4_archive_verification_0p5",
    validTime,
    leadHours: input.leadHours,
    forecastRun,
    requestedPoint: { latitude: input.latitude, longitude: input.longitude },
    gridPoint: { latitude: 50, longitude: 14 },
    selection: { variables: input.variables, pressureLevelsHpa: input.pressureLevelsHpa },
    comparison: "analysis_minus_forecast",
    forecast: {
      model: "gfs_grid4_forecast_0p5_archive", runTime: forecastRun, forecastHour: input.leadHours, validTime,
      levels: [{ pressureHpa: 850, temperatureC: 10 }], dataset: "forecast", cacheHit: true,
    },
    analysis: {
      model: "gfs_grid4_analysis_0p5", analysisTime: validTime,
      levels: [{ pressureHpa: 850, temperatureC: 10 + delta }], dataset: "analysis", cacheHit: true,
    },
    pressureLevels: [{
      pressureHpa: 850,
      changes: [{ field: "temperatureC", forecast: 10, analysis: 10 + delta, delta, deltaKind: "linear" }],
    }],
    source: { provider: "NOAA NCEI", access: "ncei_thredds_ncss", forecastArchiveAvailability: "online availability varies; older forecast data may require NCEI HAS" },
    caveat: "Forecast verification against GFS model analysis, not direct observations; historical GFS model versions changed over time",
  } as any;
}
