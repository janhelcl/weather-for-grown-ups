import { describe, expect, it, vi } from "vitest";
import { GefsAreaSummaryService, estimateGefsGridPoints } from "../src/core/gefs-area-summary.js";
import { gefsAreaSummaryQuerySchema } from "../src/schema/gefs-area-summary.js";

const run = "2026-08-24T00:00:00Z";
const validTime = "2026-08-24T06:00:00Z";
const box = { westLongitude: 14, eastLongitude: 15, southLatitude: 49, northLatitude: 50 };

describe("GEFS area statistics", () => {
  it("computes spatial statistics per member before ensemble aggregation", async () => {
    const fetchSelection = vi.fn(async (request) => ({ path: request.member, cacheHit: request.member === "c00" }));
    const extractBox = vi.fn(async (path: string) => {
      const values = path === "c00" ? [273.15, 275.15] : [277.15, 279.15];
      return values.map((value, index) => ({ longitude: 14 + index * 0.5, latitude: 50, value }));
    });
    const service = new GefsAreaSummaryService({
      concurrency: 1,
      source: { fetchSelection },
      gridDecoder: {
        extractBox,
        extractSelectedMessage: vi.fn(async () => { throw new Error("not used"); }),
      },
    });

    const result = await service.summarize({
      ...box,
      run,
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
      quantiles: [0, 0.5, 1],
      percentiles: [50],
      thresholds: [{ operator: "gte", value: 2 }],
      includeExtremaLocations: true,
      includeMembers: true,
    });

    expect(fetchSelection).toHaveBeenCalledTimes(2);
    expect(fetchSelection.mock.calls[0]?.[0]).toMatchObject({
      member: "c00",
      variableCodes: ["TMP"],
      pressureLevelsHpa: [850],
    });
    expect(result.methodology).toBe("spatial_statistics_per_member_then_ensemble_distribution");
    expect(result.statistics.mean).toMatchObject({ memberCount: 2, mean: 3, populationStdDev: 2, min: 1, max: 5 });
    expect(result.statistics.min.mean).toBe(2);
    expect(result.statistics.max.mean).toBe(4);
    expect(result.spatialPercentiles?.[0]).toMatchObject({ percentile: 50, distribution: { mean: 3 } });
    expect(result.spatialThresholdFractions?.[0]).toMatchObject({
      operator: "gte",
      threshold: 2,
      distribution: { mean: 0.75, min: 0.5, max: 1 },
      interpretation: "distribution_of_raw_member_spatial_fractions_not_calibrated_probability",
    });
    expect(result.memberExtrema).toHaveLength(2);
    expect(result.members?.[0]?.statistics.mean).toBe(1);
    expect(result.source.allCacheHit).toBe(false);
  });

  it("preserves accumulation windows across members", async () => {
    const service = new GefsAreaSummaryService({
      concurrency: 1,
      source: { fetchSelection: vi.fn(async (request) => ({ path: request.member, cacheHit: true })) },
      gridDecoder: {
        extractBox: vi.fn(async () => { throw new Error("not used"); }),
        extractSelectedMessage: vi.fn(async (path: string) => ({
          points: [{ longitude: 14, latitude: 50, value: path === "c00" ? 1 : 3 }],
          temporal: { type: "accumulation" as const, startForecastHour: 3, endForecastHour: 6 },
        })),
      },
    });

    const result = await service.summarize({
      ...box,
      run,
      validTime,
      field: "total_precipitation",
      members: ["c00", "p01"],
      quantiles: [0.5],
    });
    expect(result.selection.temporal).toEqual({
      type: "accumulation",
      startForecastHour: 3,
      endForecastHour: 6,
      startTime: "2026-08-24T03:00:00.000Z",
      endTime: "2026-08-24T06:00:00.000Z",
    });
    expect(result.statistics.mean.mean).toBe(2);
    expect(result.source).toMatchObject({ product: "pgrb2s_0p25", horizontalGridDegrees: 0.25 });
  });

  it("preserves instantaneous field semantics", async () => {
    const service = new GefsAreaSummaryService({
      concurrency: 1,
      source: { fetchSelection: vi.fn(async (request) => ({ path: request.member, cacheHit: true })) },
      gridDecoder: {
        extractBox: vi.fn(async () => { throw new Error("not used"); }),
        extractSelectedMessage: vi.fn(async () => ({
          points: [{ longitude: 14, latitude: 50, value: 100000 }],
          temporal: { type: "instantaneous" as const },
        })),
      },
    });

    const result = await service.summarize({
      ...box,
      run,
      validTime,
      field: "surface_pressure",
      members: ["c00", "p01"],
      quantiles: [0.5],
    });
    expect(result.selection.temporal).toEqual({ type: "instantaneous" });
  });

  it("rejects cross-member temporal drift", async () => {
    const service = new GefsAreaSummaryService({
      concurrency: 1,
      source: { fetchSelection: vi.fn(async (request) => ({ path: request.member, cacheHit: true })) },
      gridDecoder: {
        extractBox: vi.fn(async () => { throw new Error("not used"); }),
        extractSelectedMessage: vi.fn(async (path: string) => ({
          points: [{ longitude: 14, latitude: 50, value: 1 }],
          temporal: path === "c00"
            ? { type: "accumulation" as const, startForecastHour: 3, endForecastHour: 6 }
            : { type: "accumulation" as const, startForecastHour: 0, endForecastHour: 6 },
        })),
      },
    });

    await expect(service.summarize({
      ...box,
      run,
      validTime,
      field: "total_precipitation",
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("inconsistent temporal intervals across members");
  });

  it("keeps non-temperature pressure variables in native units", async () => {
    const service = new GefsAreaSummaryService({
      concurrency: 1,
      source: { fetchSelection: vi.fn(async (request) => ({ path: request.member, cacheHit: true })) },
      gridDecoder: {
        extractBox: vi.fn(async () => [{ longitude: 14, latitude: 50, value: 60 }]),
        extractSelectedMessage: vi.fn(async () => { throw new Error("not used"); }),
      },
    });
    const result = await service.summarize({
      ...box,
      run,
      validTime,
      variable: "relative_humidity",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
      quantiles: [0.5],
    });
    expect(result.statistics.mean.mean).toBe(60);
  });

  it("preflights both per-member and member-grid guardrails", async () => {
    const base = {
      ...box,
      run,
      validTime,
      variable: "temperature" as const,
      pressureLevelHpa: 850,
      members: ["c00", "p01"] as const,
    };
    expect(estimateGefsGridPoints(box)).toBeGreaterThan(0);
    expect(estimateGefsGridPoints(box, 0.25)).toBeGreaterThan(estimateGefsGridPoints(box, 0.5));

    const service = new GefsAreaSummaryService({
      source: { fetchSelection: vi.fn(async () => { throw new Error("should not fetch"); }) },
      gridDecoder: {
        extractBox: vi.fn(async () => []),
        extractSelectedMessage: vi.fn(async () => { throw new Error("not used"); }),
      },
    });
    await expect(service.summarize({ ...base, maxGridPoints: 1 })).rejects.toThrow("maxGridPoints");
    await expect(service.summarize({ ...base, maxGridPoints: 100, maxMemberGridPoints: 2 })).rejects.toThrow("maxMemberGridPoints");
  });

  it("validates native GEFS pressure availability", () => {
    expect(() => gefsAreaSummaryQuerySchema.parse({
      ...box,
      run,
      validTime,
      variable: "vertical_velocity",
      pressureLevelHpa: 700,
      members: ["c00", "p01"],
    })).toThrow("does not publish vertical_velocity at 700 hPa");
  });
});
