import { describe, expect, it, vi } from "vitest";
import { GefsDiagnosticTimeSeriesService } from "../src/core/gefs-diagnostic-timeseries.js";
import type { GefsLayerDiagnosticsResult } from "../src/schema/gefs-layer-diagnostics.js";
import type { GefsParcelDiagnosticsResult } from "../src/schema/gefs-parcel-diagnostics.js";
import type { GefsProfileDiagnosticsResult } from "../src/schema/gefs-profile-diagnostics.js";

const run = new Date("2026-08-23T12:00:00Z");
const start = new Date("2026-08-23T15:00:00Z");
const end = new Date("2026-08-23T18:00:00Z");
const members = ["c00", "p01"] as const;
const quantiles = [0.5];
const gridPoint = { latitude: 50, longitude: 14.5 };

function distribution(mean: number) {
  return {
    memberCount: 2,
    mean,
    populationStdDev: 1,
    min: mean - 1,
    max: mean + 1,
    quantiles: [{ quantile: 0.5, value: mean }],
  };
}

function event(count: number) {
  return {
    count,
    memberCount: 2,
    fraction: count / 2,
    interpretation: "raw_member_fraction_not_calibrated_probability" as const,
  };
}

function parcelResult(validTime: string, forecastHour: number): GefsParcelDiagnosticsResult {
  return {
    model: "gefs_0p50",
    run: run.toISOString(),
    validTime,
    forecastHour,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint,
    sampledPressureLevelsHpa: [925, 850, 700, 500, 250],
    selection: {
      parcel: "surface_2m",
      members: [...members],
      quantiles,
    },
    methodology: {
      pressureMoisture: "temperature_relative_humidity_pressure_to_specific_humidity_per_member",
      surfaceMoisture: "2m_temperature_relative_humidity_surface_pressure_to_specific_humidity_per_member",
      surfaceOrography: "same_cycle_f000_surface_geopotential_height",
    },
    summary: {
      startingPressureHpa: distribution(1000),
      startingTemperatureC: distribution(25 + forecastHour / 3),
      startingSpecificHumidityKgKg: distribution(0.01),
      lclPressureHpa: distribution(900 - forecastHour),
      lclTemperatureC: distribution(18),
      capeJkg: distribution(500 + 10 * forecastHour),
      cinJkg: distribution(-30),
      membersWithPositiveCape: event(2),
      lfc: {
        membersWithBoundary: event(2),
        pressureHpa: distribution(800),
        geopotentialHeightGpm: distribution(1900),
      },
      el: {
        membersWithBoundary: event(1),
        pressureHpa: distribution(300),
        geopotentialHeightGpm: distribution(9000),
      },
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

const unusedLayerGetter = {
  getLayerDiagnostics: async () => { throw new Error("layer getter should not be called"); },
};
const unusedProfileGetter = {
  getProfileDiagnostics: async () => { throw new Error("profile getter should not be called"); },
};

describe("GEFS parcel diagnostic time series", () => {
  it("fixes one run across native steps and returns compact parcel summaries", async () => {
    const rangeResolver = vi.fn(async () => run);
    const calls: unknown[] = [];
    const service = new GefsDiagnosticTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: rangeResolver },
      layerDiagnosticsGetter: unusedLayerGetter as unknown as { getLayerDiagnostics(query: never): Promise<GefsLayerDiagnosticsResult> },
      profileDiagnosticsGetter: unusedProfileGetter as unknown as { getProfileDiagnostics(query: never): Promise<GefsProfileDiagnosticsResult> },
      parcelDiagnosticsGetter: {
        getParcelDiagnostics: async (query) => {
          calls.push(query);
          const validTime = new Date(query.validTime);
          const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
          return parcelResult(validTime.toISOString(), forecastHour);
        },
      },
      stepConcurrency: 2,
    });

    const result = await service.getDiagnosticTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [250, 500, 700, 850, 925],
        parcel: "surface_2m",
      },
      members: [...members],
      quantiles,
      maxSteps: 2,
    });

    expect(rangeResolver).toHaveBeenCalledWith(start, end, [...members]);
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        run: run.toISOString(),
        pressureLevelsHpa: [925, 850, 700, 500, 250],
        parcel: "surface_2m",
        includeMembers: false,
      }),
    ]));
    expect(result.selection.diagnostic).toEqual({
      kind: "parcel",
      pressureLevelsHpa: [925, 850, 700, 500, 250],
      parcel: "surface_2m",
    });
    expect(result.parcelMethodology?.surfaceOrography).toBe("same_cycle_f000_surface_geopotential_height");
    expect(result.series.map((step) => step.forecastHour)).toEqual([3, 6]);
    expect(result.series.every((step) => step.kind === "parcel")).toBe(true);
    const first = result.series[0];
    if (!first || first.kind !== "parcel") throw new Error("Expected parcel step");
    expect(first.summary.capeJkg.mean).toBe(530);
    expect(first).not.toHaveProperty("members");
    expect(result.source.allCacheHit).toBe(false);
  });

  it("rejects unsupported parcel pressure levels before calling the parcel service", async () => {
    const getParcelDiagnostics = vi.fn(async () => parcelResult(start.toISOString(), 3));
    const service = new GefsDiagnosticTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: async () => run },
      layerDiagnosticsGetter: unusedLayerGetter as unknown as { getLayerDiagnostics(query: never): Promise<GefsLayerDiagnosticsResult> },
      profileDiagnosticsGetter: unusedProfileGetter as unknown as { getProfileDiagnostics(query: never): Promise<GefsProfileDiagnosticsResult> },
      parcelDiagnosticsGetter: { getParcelDiagnostics },
    });

    await expect(service.getDiagnosticTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [925, 300],
        parcel: "surface_2m",
      },
      members: [...members],
    })).rejects.toThrow("temperature, relative humidity and geopotential height");
    expect(getParcelDiagnostics).not.toHaveBeenCalled();
  });
});
