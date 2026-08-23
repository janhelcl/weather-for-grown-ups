import { describe, expect, it, vi } from "vitest";
import { GefsDiagnosticTimeSeriesService } from "../src/core/gefs-diagnostic-timeseries.js";
import type { GefsLayerDiagnosticsResult } from "../src/schema/gefs-layer-diagnostics.js";
import type { GefsProfileDiagnosticsResult } from "../src/schema/gefs-profile-diagnostics.js";

const run = new Date("2026-08-23T12:00:00Z");
const start = new Date("2026-08-23T15:00:00Z");
const end = new Date("2026-08-23T21:00:00Z");
const members = ["c00", "p01"] as const;
const quantiles = [0.5];
const gridPoint = { latitude: 50, longitude: 14.5 };

function distribution(mean: number) {
  return {
    memberCount: 2,
    mean,
    populationStdDev: 0.5,
    min: mean - 0.5,
    max: mean + 0.5,
    quantiles: [{ quantile: 0.5, value: mean }],
  };
}

function layerResult(validTime: string, forecastHour: number, offset = 0): GefsLayerDiagnosticsResult {
  return {
    model: "gefs_0p50",
    run: run.toISOString(),
    validTime,
    forecastHour,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint,
    pressureLayer: { lowerPressureHpa: 850, upperPressureHpa: 500 },
    selection: { diagnostics: ["temperature_lapse_rate"], members: [...members], quantiles },
    layerDepthGpm: distribution(4100 + offset),
    summaries: [{
      id: "temperature_lapse_rate",
      field: "temperatureLapseRateCPerKm",
      unit: "degC/km",
      distribution: distribution(6 + offset / 100),
    }],
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      product: "pgrb2a_0p50",
      allCacheHit: offset === 0,
    },
  };
}

function profileResult(validTime: string, forecastHour: number, fraction: number): GefsProfileDiagnosticsResult {
  return {
    model: "gefs_0p50",
    run: run.toISOString(),
    validTime,
    forecastHour,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint,
    sampledPressureLevelsHpa: [1000, 925, 850, 700, 500],
    selection: {
      diagnostics: ["freezing_level_crossings"],
      members: [...members],
      quantiles,
    },
    summaries: [{
      id: "freezing_level_crossings",
      membersWithAnyCrossing: {
        count: fraction === 1 ? 2 : 1,
        memberCount: 2,
        fraction,
        interpretation: "raw_member_fraction_not_calibrated_probability",
      },
      crossingCount: distribution(fraction),
      lowestCrossing: {
        contributingMemberCount: fraction === 1 ? 2 : 1,
        geopotentialHeightGpm: distribution(2800 + forecastHour),
        pressureHpa: distribution(730 - forecastHour),
      },
      highestCrossing: {
        contributingMemberCount: fraction === 1 ? 2 : 1,
        geopotentialHeightGpm: distribution(2800 + forecastHour),
        pressureHpa: distribution(730 - forecastHour),
      },
    }],
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      product: "pgrb2a_0p50",
      allCacheHit: true,
    },
  };
}

describe("GEFS diagnostic time series", () => {
  it("resolves one run for the range and composes compact layer summaries at native steps", async () => {
    const rangeResolver = vi.fn(async () => run);
    const calls: unknown[] = [];
    const service = new GefsDiagnosticTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: rangeResolver },
      layerDiagnosticsGetter: {
        getLayerDiagnostics: async (query) => {
          calls.push(query);
          const validTime = new Date(query.validTime);
          const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
          return layerResult(validTime.toISOString(), forecastHour, forecastHour - 3);
        },
      },
      profileDiagnosticsGetter: { getProfileDiagnostics: async () => profileResult(start.toISOString(), 3, 1) },
      stepConcurrency: 2,
    });

    const result = await service.getDiagnosticTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate"],
      },
      members: [...members],
      quantiles,
      maxSteps: 3,
    });

    expect(rangeResolver).toHaveBeenCalledWith(start, end, [...members]);
    expect(calls).toHaveLength(3);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ run: run.toISOString(), validTime: start.toISOString(), includeMembers: false }),
      expect.objectContaining({ run: run.toISOString(), validTime: "2026-08-23T18:00:00.000Z", includeMembers: false }),
      expect.objectContaining({ run: run.toISOString(), validTime: end.toISOString(), includeMembers: false }),
    ]));
    expect(result.run).toBe(run.toISOString());
    expect(result.series.map((step) => step.forecastHour)).toEqual([3, 6, 9]);
    expect(result.series.every((step) => step.kind === "layer")).toBe(true);
    expect(result.source.allCacheHit).toBe(false);
    expect(result.selection.members).toEqual([...members]);
  });

  it("composes profile structural summaries without member payloads", async () => {
    const service = new GefsDiagnosticTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: async () => run },
      layerDiagnosticsGetter: { getLayerDiagnostics: async () => layerResult(start.toISOString(), 3) },
      profileDiagnosticsGetter: {
        getProfileDiagnostics: async (query) => {
          const validTime = new Date(query.validTime);
          const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
          return profileResult(validTime.toISOString(), forecastHour, forecastHour === 3 ? 0.5 : 1);
        },
      },
    });

    const result = await service.getDiagnosticTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: start.toISOString(),
      endTime: "2026-08-23T18:00:00Z",
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [500, 1000, 925, 850, 700],
        diagnostics: ["freezing_level_crossings"],
      },
      members: [...members],
      quantiles,
    });

    expect(result.selection.diagnostic).toEqual({
      kind: "profile",
      pressureLevelsHpa: [1000, 925, 850, 700, 500],
      diagnostics: ["freezing_level_crossings"],
    });
    expect(result.series).toHaveLength(2);
    const first = result.series[0];
    expect(first?.kind).toBe("profile");
    if (!first || first.kind !== "profile") throw new Error("Expected profile step");
    const freezing = first.summaries[0];
    expect(freezing?.id).toBe("freezing_level_crossings");
    if (!freezing || freezing.id !== "freezing_level_crossings") throw new Error("Expected freezing summary");
    expect(freezing.membersWithAnyCrossing.fraction).toBe(0.5);
  });

  it("rejects non-native bounds and ranges larger than maxSteps before diagnostic calls", async () => {
    const getLayerDiagnostics = vi.fn(async () => layerResult(start.toISOString(), 3));
    const service = new GefsDiagnosticTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: async () => run },
      layerDiagnosticsGetter: { getLayerDiagnostics },
      profileDiagnosticsGetter: { getProfileDiagnostics: async () => profileResult(start.toISOString(), 3, 1) },
    });
    const base = {
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      diagnostic: {
        kind: "layer" as const,
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate"] as const,
      },
      members: [...members],
      quantiles,
    };
    await expect(service.getDiagnosticTimeSeries({
      ...base,
      startTime: "2026-08-23T16:00:00Z",
      endTime: "2026-08-23T18:00:00Z",
    })).rejects.toThrow("native three-hour");
    await expect(service.getDiagnosticTimeSeries({
      ...base,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      maxSteps: 2,
    })).rejects.toThrow("exceeding maxSteps=2");
    expect(getLayerDiagnostics).not.toHaveBeenCalled();
  });

  it("rejects a grid-point drift between forecast steps", async () => {
    let call = 0;
    const service = new GefsDiagnosticTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: async () => run },
      layerDiagnosticsGetter: {
        getLayerDiagnostics: async (query) => {
          call += 1;
          const validTime = new Date(query.validTime);
          const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
          const result = layerResult(validTime.toISOString(), forecastHour);
          return call === 2 ? { ...result, gridPoint: { latitude: 50.5, longitude: 14.5 } } : result;
        },
      },
      profileDiagnosticsGetter: { getProfileDiagnostics: async () => profileResult(start.toISOString(), 3, 1) },
      stepConcurrency: 1,
    });
    await expect(service.getDiagnosticTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: start.toISOString(),
      endTime: "2026-08-23T18:00:00Z",
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate"],
      },
      members: [...members],
      quantiles,
    })).rejects.toThrow("inconsistent grid points");
  });
});
