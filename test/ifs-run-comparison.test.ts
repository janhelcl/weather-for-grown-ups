import { describe, expect, it, vi } from "vitest";
import { IfsRunComparisonService } from "../src/core/ifs-run-comparison.js";
import type { IfsPointQueryInput, IfsProfileResult } from "../src/schema/ifs.js";

const validTime = "2026-08-28T12:00:00.000Z";
const anchorRun = new Date("2026-08-28T06:00:00Z");
const olderRun = new Date("2026-08-28T00:00:00Z");
const requestedPoint = { latitude: 50.08, longitude: 14.43 };
const gridPoint = { latitude: 50, longitude: 14.5 };

function profile(run: Date): IfsProfileResult {
  const newer = run.getTime() === anchorRun.getTime();
  const forecastHour = (new Date(validTime).getTime() - run.getTime()) / 3_600_000;
  return {
    model: "ifs_0p25",
    run: run.toISOString(),
    validTime,
    forecastHour,
    requestedPoint,
    gridPoint,
    levels: [{
      pressureHpa: 850,
      temperatureC: newer ? 12 : 10,
      windSpeedMs: newer ? 8 : 6,
      windDirectionDeg: newer ? 10 : 350,
    }],
    fields: [
      {
        id: "wind_10m",
        level: { type: "height_above_ground_m", heightM: 10 },
        temporal: { type: "instantaneous" },
        values: {
          windSpeedMs: newer ? 7 : 5,
          windDirectionDeg: newer ? 10 : 350,
        },
      },
      {
        id: "total_precipitation",
        level: { type: "surface" },
        temporal: {
          type: "accumulation",
          startForecastHour: 0,
          endForecastHour: forecastHour,
          startTime: run.toISOString(),
          endTime: validTime,
        },
        values: { totalPrecipitationMm: newer ? 2 : 3 },
      },
    ],
    source: {
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      product: "ifs_0p25_oper_fc",
      horizontalGridDegrees: 0.25,
      cacheHit: newer,
    },
  };
}

describe("IFS run comparison", () => {
  it("compares consecutive IFS cycles and preserves circular direction semantics", async () => {
    const resolveLatestRun = vi.fn(async () => anchorRun);
    const getProfile = vi.fn(async (query: IfsPointQueryInput) =>
      profile(new Date(String(query.run))));
    const service = new IfsRunComparisonService({
      latestRunProvider: { resolveLatestRun },
      profileGetter: { getProfile },
      concurrency: 1,
    });

    const result = await service.compareRuns({
      latitude: requestedPoint.latitude,
      longitude: requestedPoint.longitude,
      anchorRun: "latest",
      validTime,
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850],
      fields: ["wind_10m", "total_precipitation"],
      cycles: 2,
    });

    expect(resolveLatestRun).toHaveBeenCalledWith(
      new Date(validTime),
      expect.arrayContaining([
        expect.objectContaining({ param: "t", levtype: "pl", levelist: 850 }),
        expect.objectContaining({ param: "u", levtype: "pl", levelist: 850 }),
        expect.objectContaining({ param: "v", levtype: "pl", levelist: 850 }),
        expect.objectContaining({ param: "10u", levtype: "sfc" }),
        expect.objectContaining({ param: "10v", levtype: "sfc" }),
        expect.objectContaining({ param: "tp", levtype: "sfc" }),
      ]),
    );
    expect(result.runs.map((snapshot) => snapshot.run)).toEqual([
      olderRun.toISOString(),
      anchorRun.toISOString(),
    ]);
    expect(result.runs.map((snapshot) => snapshot.forecastHour)).toEqual([12, 6]);

    const transition = result.comparisons[0]!;
    const levelChanges = transition.pressureLevels[0]!.changes;
    expect(levelChanges.find((change) => change.field === "temperatureC")?.delta).toBe(2);
    expect(levelChanges.find((change) => change.field === "windDirectionDeg")).toMatchObject({
      delta: 20,
      deltaKind: "circular_degrees",
    });

    const windField = transition.fields.find((field) => field.id === "wind_10m");
    expect(windField?.comparable).toBe(true);
    expect(windField?.changes.find((change) => change.field === "windDirectionDeg"))
      .toMatchObject({ delta: 20, deltaKind: "circular_degrees" });

    const precipitation = transition.fields.find((field) => field.id === "total_precipitation");
    expect(precipitation).toEqual({
      id: "total_precipitation",
      comparable: false,
      reason: "temporal_windows_differ",
      changes: [],
    });
    expect(result.source).toMatchObject({
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      product: "ifs_0p25_oper_fc",
      horizontalGridDegrees: 0.25,
    });
  });

  it("supports explicit field-only comparisons and reports vertical incompatibility", async () => {
    const getProfile = vi.fn(async (query: IfsPointQueryInput): Promise<IfsProfileResult> => {
      const currentRun = new Date(String(query.run));
      const newer = currentRun.getTime() === anchorRun.getTime();
      return {
        ...profile(currentRun),
        levels: [],
        fields: [{
          id: "wind_10m",
          level: newer
            ? { type: "height_above_ground_m", heightM: 100 }
            : { type: "height_above_ground_m", heightM: 10 },
          temporal: { type: "instantaneous" },
          values: { windSpeedMs: newer ? 8 : 6 },
        }],
      };
    });
    const service = new IfsRunComparisonService({
      profileGetter: { getProfile },
      concurrency: 1,
    });

    const result = await service.compareRuns({
      latitude: requestedPoint.latitude,
      longitude: requestedPoint.longitude,
      anchorRun: anchorRun.toISOString(),
      validTime,
      fields: ["wind_10m"],
      cycles: 2,
    });

    expect(getProfile).toHaveBeenCalledWith(expect.not.objectContaining({
      variables: expect.anything(),
      pressureLevelsHpa: expect.anything(),
    }));
    expect(result.comparisons[0]?.fields[0]).toEqual({
      id: "wind_10m",
      comparable: false,
      reason: "vertical_semantics_differ",
      changes: [],
    });
  });

  it("reports missing fields and temporal-type incompatibility explicitly", async () => {
    const missingService = new IfsRunComparisonService({
      profileGetter: {
        getProfile: vi.fn(async (query: IfsPointQueryInput): Promise<IfsProfileResult> => {
          const currentRun = new Date(String(query.run));
          const newer = currentRun.getTime() === anchorRun.getTime();
          return {
            ...profile(currentRun),
            levels: [],
            fields: newer ? [] : [{
              id: "temperature_2m",
              level: { type: "height_above_ground_m", heightM: 2 },
              temporal: { type: "instantaneous" },
              values: { temperatureC: 10 },
            }],
          };
        }),
      },
      concurrency: 1,
    });
    const missing = await missingService.compareRuns({
      latitude: 50,
      longitude: 14,
      anchorRun: anchorRun.toISOString(),
      validTime,
      fields: ["temperature_2m"],
      cycles: 2,
    });
    expect(missing.comparisons[0]?.fields[0]).toEqual({
      id: "temperature_2m",
      comparable: false,
      reason: "field_missing_in_one_run",
      changes: [],
    });

    const temporalService = new IfsRunComparisonService({
      profileGetter: {
        getProfile: vi.fn(async (query: IfsPointQueryInput): Promise<IfsProfileResult> => {
          const currentRun = new Date(String(query.run));
          const newer = currentRun.getTime() === anchorRun.getTime();
          return {
            ...profile(currentRun),
            levels: [],
            fields: [{
              id: "temperature_2m",
              level: { type: "height_above_ground_m", heightM: 2 },
              temporal: newer
                ? {
                    type: "accumulation",
                    startForecastHour: 0,
                    endForecastHour: 6,
                    startTime: currentRun.toISOString(),
                    endTime: validTime,
                  }
                : { type: "instantaneous" },
              values: { temperatureC: newer ? 12 : 10 },
            }],
          };
        }),
      },
      concurrency: 1,
    });
    const temporal = await temporalService.compareRuns({
      latitude: 50,
      longitude: 14,
      anchorRun: anchorRun.toISOString(),
      validTime,
      fields: ["temperature_2m"],
      cycles: 2,
    });
    expect(temporal.comparisons[0]?.fields[0]).toEqual({
      id: "temperature_2m",
      comparable: false,
      reason: "temporal_windows_differ",
      changes: [],
    });
  });

  it("validates IFS run-comparison selection invariants before I/O", async () => {
    const service = new IfsRunComparisonService({
      profileGetter: { getProfile: vi.fn() },
    });
    const common = {
      latitude: 50,
      longitude: 14,
      anchorRun: anchorRun.toISOString(),
      validTime,
      cycles: 2,
    };

    await expect(service.compareRuns({
      ...common,
      variables: ["temperature"],
    } as any)).rejects.toThrow("must be supplied together");

    await expect(service.compareRuns({
      ...common,
    } as any)).rejects.toThrow("Request at least one IFS pressure variable or field");

    await expect(service.compareRuns({
      ...common,
      variables: ["temperature", "temperature"],
      pressureLevelsHpa: [850],
    } as any)).rejects.toThrow("variables must not contain duplicates");

    await expect(service.compareRuns({
      ...common,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 850],
    } as any)).rejects.toThrow("pressureLevelsHpa must not contain duplicates");

    await expect(service.compareRuns({
      ...common,
      fields: ["wind_10m", "wind_10m"],
    } as any)).rejects.toThrow("fields must not contain duplicates");
  });

  it("wraps source/cadence failures with the offending IFS run", async () => {
    const getProfile = vi.fn(async () => {
      throw new Error("IFS run does not publish f150");
    });
    const service = new IfsRunComparisonService({
      profileGetter: { getProfile },
      concurrency: 1,
    });

    await expect(service.compareRuns({
      latitude: 50,
      longitude: 14,
      anchorRun: "2026-08-28T12:00:00Z",
      validTime: "2026-09-03T18:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      cycles: 2,
    })).rejects.toThrow("Cannot compare IFS run");
  });
});
