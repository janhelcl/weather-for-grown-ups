import { describe, expect, it } from "vitest";
import { GefsEnsembleTimeSeriesService } from "../src/core/gefs-ensemble-timeseries.js";
import type { GefsEnsembleQueryInput, GefsEnsembleResult } from "../src/schema/gefs-ensemble.js";

const run = "2026-08-23T12:00:00.000Z";

function resultFor(query: GefsEnsembleQueryInput): GefsEnsembleResult {
  const validTime = new Date(query.validTime);
  const forecastHour = (validTime.getTime() - new Date(run).getTime()) / 3_600_000;
  const members = query.members ?? ["c00", "p01", "p02"];
  const base = forecastHour;
  const values = members.map((member, index) => ({ member, value: base + index, cacheHit: forecastHour === 3 }));
  const numeric = values.map((sample) => sample.value);
  return {
    model: "gefs_0p50",
    run,
    validTime: validTime.toISOString(),
    forecastHour,
    requestedPoint: { latitude: query.latitude, longitude: query.longitude },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: {
      variable: query.variable,
      gfsCode: query.variable === "temperature" ? "TMP" : "HGT",
      pressureLevelHpa: query.pressureLevelHpa,
      outputField: query.variable === "temperature" ? "temperatureC" : "geopotentialHeightM",
      unit: query.variable === "temperature" ? "degC" : "m",
    },
    members: values,
    summary: {
      memberCount: values.length,
      mean: numeric.reduce((sum, value) => sum + value, 0) / numeric.length,
      populationStdDev: Math.sqrt(2 / 3),
      min: Math.min(...numeric),
      max: Math.max(...numeric),
      quantiles: [{ quantile: 0.5, value: base + 1 }],
      ...(query.thresholdGte === undefined ? {} : {
        threshold: {
          operator: "gte" as const,
          value: query.thresholdGte,
          count: numeric.filter((value) => value >= query.thresholdGte!).length,
          fraction: numeric.filter((value) => value >= query.thresholdGte!).length / numeric.length,
          interpretation: "raw_member_fraction_not_calibrated_probability" as const,
        },
      }),
    },
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      product: "pgrb2a_0p50",
      allCacheHit: forecastHour === 3,
    },
  };
}

describe("GEFS ensemble time-series service", () => {
  it("resolves one run for the complete range and returns compact summaries by default", async () => {
    const calls: GefsEnsembleQueryInput[] = [];
    const service = new GefsEnsembleTimeSeriesService({
      stepConcurrency: 2,
      latestRunRangeProvider: {
        resolveLatestRunRange: async (start, end, members) => {
          expect(start.toISOString()).toBe("2026-08-23T15:00:00.000Z");
          expect(end.toISOString()).toBe("2026-08-23T21:00:00.000Z");
          expect(members).toEqual(["c00", "p01", "p02"]);
          return new Date(run);
        },
      },
      ensembleGetter: {
        getEnsemble: async (query) => {
          calls.push(query);
          return resultFor(query);
        },
      },
    });

    const result = await service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      startTime: "2026-08-23T15:00:00Z",
      endTime: "2026-08-23T21:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p02", "c00", "p01"],
      quantiles: [0.5],
      thresholdGte: 5,
    });

    expect(result.run).toBe(run);
    expect(result.stepHours).toBe(3);
    expect(result.includeMembers).toBe(false);
    expect(result.selection.members).toEqual(["c00", "p01", "p02"]);
    expect(result.series.map((step) => step.forecastHour)).toEqual([3, 6, 9]);
    expect(result.series.every((step) => step.members === undefined)).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.run === run)).toBe(true);
    expect(result.source.allCacheHit).toBe(false);
  });

  it("includes individual member trajectories only when explicitly requested", async () => {
    const service = new GefsEnsembleTimeSeriesService({
      ensembleGetter: { getEnsemble: async (query) => resultFor(query) },
      latestRunRangeProvider: { resolveLatestRunRange: async () => new Date(run) },
    });

    const result = await service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run,
      startTime: "2026-08-23T15:00:00Z",
      endTime: "2026-08-23T18:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01", "p02"],
      quantiles: [0.5],
      includeMembers: true,
    });

    expect(result.includeMembers).toBe(true);
    expect(result.series).toHaveLength(2);
    expect(result.series[0]?.members?.map((sample) => sample.member)).toEqual(["c00", "p01", "p02"]);
  });

  it("rejects non-native bounds and ranges above maxSteps before calling the ensemble getter", async () => {
    let calls = 0;
    const service = new GefsEnsembleTimeSeriesService({
      ensembleGetter: { getEnsemble: async (query) => { calls += 1; return resultFor(query); } },
      latestRunRangeProvider: { resolveLatestRunRange: async () => new Date(run) },
    });

    await expect(service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run,
      startTime: "2026-08-23T16:00:00Z",
      endTime: "2026-08-23T18:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("exact native three-hour valid times");

    await expect(service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run,
      startTime: "2026-08-23T15:00:00Z",
      endTime: "2026-08-23T21:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxSteps: 2,
    })).rejects.toThrow("exceeding maxSteps=2");
    expect(calls).toBe(0);
  });
});
