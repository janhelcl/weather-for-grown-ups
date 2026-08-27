import { describe, expect, it, vi } from "vitest";
import {
  IgraForecastSkillService,
  enumerateNominalTimes,
  evenlySampleTimes,
} from "../src/core/igra-skill.js";

describe("IGRA skill time sampling", () => {
  it("enumerates requested nominal cycles inclusively", () => {
    const times = enumerateNominalTimes(
      new Date("2026-08-01T06:00:00Z"),
      new Date("2026-08-02T12:00:00Z"),
      [0, 12],
    );
    expect(times.map((time) => time.toISOString())).toEqual([
      "2026-08-01T12:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-02T12:00:00.000Z",
    ]);
  });

  it("deterministically samples the whole period rather than only its start", () => {
    const times = Array.from({ length: 10 }, (_, index) =>
      new Date(Date.UTC(2026, 7, 1 + index, 12)));
    expect(evenlySampleTimes(times, 3).map((time) => time.getUTCDate())).toEqual([1, 6, 10]);
    expect(evenlySampleTimes(times, 1)[0]?.getUTCDate()).toBe(5);
    expect(evenlySampleTimes(times, 20)).toEqual(times);
  });
});

describe("IgraForecastSkillService", () => {
  it("aggregates count, bias, MAE and RMSE independently by lead and field", async () => {
    const verifier = {
      verify: vi.fn(async (input: any) => {
        const day = new Date(input.validTime).getUTCDate();
        const temperatureDelta = input.leadHours === 24
          ? (day === 1 ? 1 : 3)
          : (day === 1 ? -2 : 2);
        const directionDelta = day === 1 ? -20 : 20;
        return atomicResult(input, [
          change("temperatureC", temperatureDelta),
          change("windDirectionDeg", directionDelta, "circular_degrees"),
        ]);
      }),
    };
    const service = new IgraForecastSkillService({
      verifier: verifier as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.summarize({
      latitude: 50.08,
      longitude: 14.43,
      startTime: "2026-08-01T12:00:00Z",
      endTime: "2026-08-02T12:00:00Z",
      cycleHoursUtc: [12],
      leadHours: [24, 48],
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850],
      stationId: "EZM00011520",
      maxValidTimes: 8,
    });

    expect(verifier.verify).toHaveBeenCalledTimes(4);
    expect(result.availability).toEqual({
      requestedEvaluations: 4,
      successfulEvaluations: 4,
      failedEvaluations: 0,
      successRate: 1,
    });

    expect(result.statistics).toContainEqual({
      leadHours: 24,
      pressureHpa: 850,
      field: "temperatureC",
      deltaKind: "linear",
      count: 2,
      bias: 2,
      mae: 2,
      rmse: Math.sqrt(5),
    });
    expect(result.statistics).toContainEqual({
      leadHours: 24,
      pressureHpa: 850,
      field: "windDirectionDeg",
      deltaKind: "circular_degrees",
      count: 2,
      bias: 0,
      mae: 20,
      rmse: 20,
    });
    expect(result.statistics).toContainEqual({
      leadHours: 48,
      pressureHpa: 850,
      field: "temperatureC",
      deltaKind: "linear",
      count: 2,
      bias: 0,
      mae: 2,
      rmse: 2,
    });
  });

  it("keeps failed evaluations explicit and reduces each statistic's count", async () => {
    const verifier = {
      verify: vi.fn(async (input: any) => {
        if (input.leadHours === 48) throw new Error("IGRA station has no sounding");
        return atomicResult(input, [change("temperatureC", 2)]);
      }),
    };
    const service = new IgraForecastSkillService({
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
    expect(result.evaluations[1]).toMatchObject({
      status: "failed",
      leadHours: 48,
      error: "IGRA station has no sounding",
    });
    expect(result.statistics).toEqual([expect.objectContaining({
      leadHours: 24,
      count: 1,
      bias: 2,
      mae: 2,
      rmse: 2,
    })]);
  });

  it("reports deterministic truncation of a dense period", async () => {
    const verifier = {
      verify: vi.fn(async (input: any) => atomicResult(input, [change("temperatureC", 0)])),
    };
    const service = new IgraForecastSkillService({
      verifier: verifier as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.summarize({
      latitude: 50,
      longitude: 14,
      startTime: "2026-08-01T00:00:00Z",
      endTime: "2026-08-10T12:00:00Z",
      cycleHoursUtc: [0, 12],
      leadHours: [24],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxValidTimes: 3,
    });

    expect(result.period.eligibleValidTimes).toBe(20);
    expect(result.period.sampledValidTimes).toHaveLength(3);
    expect(result.period.truncated).toBe(true);
    expect(verifier.verify).toHaveBeenCalledTimes(3);
  });

  it("returns an empty but explicit summary when the range contains no selected cycle", async () => {
    const verifier = { verify: vi.fn() };
    const service = new IgraForecastSkillService({
      verifier: verifier as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.summarize({
      latitude: 50,
      longitude: 14,
      startTime: "2026-08-01T01:00:00Z",
      endTime: "2026-08-01T05:00:00Z",
      cycleHoursUtc: [0, 12],
      leadHours: [24],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });

    expect(result.period.eligibleValidTimes).toBe(0);
    expect(result.evaluations).toEqual([]);
    expect(result.statistics).toEqual([]);
    expect(result.availability.successRate).toBe(0);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("rejects future and overly long periods before archive work", async () => {
    const verifier = { verify: vi.fn() };
    const service = new IgraForecastSkillService({
      verifier: verifier as any,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    await expect(service.summarize({
      latitude: 50,
      longitude: 14,
      startTime: "2026-08-01T00:00:00Z",
      endTime: "2026-08-28T00:00:00Z",
      leadHours: [24],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).rejects.toThrow(/endTime must not be in the future/);

    await expect(service.summarize({
      latitude: 50,
      longitude: 14,
      startTime: "2025-01-01T00:00:00Z",
      endTime: "2026-08-01T00:00:00Z",
      leadHours: [24],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).rejects.toThrow(/must not exceed 366 days/);

    expect(verifier.verify).not.toHaveBeenCalled();
  });
});

function change(
  field: string,
  delta: number,
  deltaKind: "linear" | "circular_degrees" = "linear",
) {
  return {
    field,
    forecast: 10,
    observation: 10 + delta,
    delta,
    deltaKind,
  };
}

function atomicResult(input: any, changes: any[]) {
  return {
    model: "gfs_igra_verification",
    validTime: new Date(input.validTime).toISOString(),
    leadHours: input.leadHours,
    forecastRun: new Date(
      new Date(input.validTime).getTime() - input.leadHours * 3_600_000,
    ).toISOString(),
    gfsGrid: input.gfsGrid ?? "0p25",
    requestedPoint: { latitude: input.latitude, longitude: input.longitude },
    station: {
      id: "EZM00011520",
      name: "PRAHA-LIBUS",
      latitude: 50.0078,
      longitude: 14.4469,
      elevationM: 302,
      firstYear: 1969,
      lastYear: 2026,
      distanceKm: 5,
      soundingLatitude: 50.0078,
      soundingLongitude: 14.4469,
    },
    selection: {
      variables: input.variables,
      pressureLevelsHpa: input.pressureLevelsHpa,
    },
    comparison: "observation_minus_forecast",
    forecast: {
      model: "gfs_0p25_forecast_archive",
      runTime: new Date(
        new Date(input.validTime).getTime() - input.leadHours * 3_600_000,
      ).toISOString(),
      forecastHour: input.leadHours,
      validTime: new Date(input.validTime).toISOString(),
      gridPoint: { latitude: 50, longitude: 14.5 },
      levels: [],
      dataset: "test",
      cacheHit: true,
    },
    observation: {
      dataset: "igra_v2_2",
      nominalTime: new Date(input.validTime).toISOString(),
      levels: [],
      sourceFile: "test.zip",
      cacheHit: true,
    },
    matchedPressureLevelsHpa: [850],
    missingPressureLevelsHpa: [],
    pressureLevels: [{ pressureHpa: 850, changes }],
    source: {
      provider: "NOAA NCEI",
      observationAccess: "igra_v2_2_station_file",
      forecastArchiveAccess: "gdex_thredds_ncss",
    },
    caveat:
      "Radiosonde verification compares a point observation profile with a model grid-cell forecast; no vertical interpolation is performed, and sounding drift/instrument or station changes can affect comparability",
  } as any;
}
