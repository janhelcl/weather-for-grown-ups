import { describe, expect, it, vi } from "vitest";
import { IfsEnsDiagnosticTimeSeriesService } from "../src/core/ifs-ens-diagnostic-timeseries.js";
import type {
  IfsEnsLayerDiagnosticsResult,
  IfsEnsParcelDiagnosticsResult,
  IfsEnsProfileDiagnosticsResult,
} from "../src/schema/ifs-ens-diagnostics.js";

const run = new Date("2026-08-27T12:00:00Z");
const gridPoint = { latitude: 50, longitude: 14.5 };
const source = {
  provider: "ECMWF Open Data" as const,
  access: "indexed_http_range" as const,
  decoder: "gribberish" as const,
  product: "ifs_0p25_enfo_ef" as const,
  horizontalGridDegrees: 0.25 as const,
  allCacheHit: false,
  memberSemantics: "50_perturbed_members_control_is_oper_fc" as const,
};
const distribution = (mean: number) => ({
  memberCount: 2,
  mean,
  populationStdDev: 1,
  min: mean - 1,
  max: mean + 1,
  quantiles: [{ quantile: 0.5, value: mean }],
});

function layerResult(validTime: string, forecastHour: number): IfsEnsLayerDiagnosticsResult {
  return {
    model: "ifs_ens_0p25",
    run: run.toISOString(),
    validTime,
    forecastHour,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint,
    pressureLayer: { lowerPressureHpa: 850, upperPressureHpa: 500 },
    selection: {
      diagnostics: ["temperature_lapse_rate"],
      members: ["p01", "p02"],
      quantiles: [0.5],
    },
    layerDepthGpm: distribution(4000),
    summaries: [{
      id: "temperature_lapse_rate",
      field: "temperatureLapseRateCPerKm",
      unit: "degC/km",
      distribution: distribution(6),
    }],
    source,
  };
}

function profileResult(validTime: string, forecastHour: number): IfsEnsProfileDiagnosticsResult {
  return {
    model: "ifs_ens_0p25",
    run: run.toISOString(),
    validTime,
    forecastHour,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint,
    sampledPressureLevelsHpa: [925, 850, 700, 500],
    selection: {
      diagnostics: ["freezing_level_crossings"],
      members: ["p01", "p02"],
      quantiles: [0.5],
    },
    summaries: [{
      id: "freezing_level_crossings",
      membersWithAnyCrossing: {
        count: 2,
        memberCount: 2,
        fraction: 1,
        interpretation: "raw_member_fraction_not_calibrated_probability",
      },
      crossingCount: distribution(1),
      lowestCrossing: {
        contributingMemberCount: 2,
        geopotentialHeightGpm: distribution(2500),
        pressureHpa: distribution(700),
      },
      highestCrossing: {
        contributingMemberCount: 2,
        geopotentialHeightGpm: distribution(2500),
        pressureHpa: distribution(700),
      },
    }],
    source,
  };
}

function parcelResult(validTime: string, forecastHour: number): IfsEnsParcelDiagnosticsResult {
  return {
    model: "ifs_ens_0p25",
    run: run.toISOString(),
    validTime,
    forecastHour,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint,
    sampledPressureLevelsHpa: [925, 850, 700, 500],
    selection: {
      parcel: "surface_2m",
      members: ["p01", "p02"],
      quantiles: [0.5],
    },
    methodology: {
      pressureMoisture: "ifs_specific_humidity_direct_per_member",
      surfaceMoisture: "2m_temperature_dew_point_surface_pressure_to_specific_humidity_per_member",
      surfaceOrography: "same_cycle_f000_surface_geopotential_height",
    },
    summary: {
      startingPressureHpa: distribution(1000),
      startingTemperatureC: distribution(20),
      startingSpecificHumidityKgKg: distribution(0.008),
      lclPressureHpa: distribution(850),
      lclTemperatureC: distribution(10),
      capeJkg: distribution(500),
      cinJkg: distribution(-20),
      membersWithPositiveCape: {
        count: 2,
        memberCount: 2,
        fraction: 1,
        interpretation: "raw_member_fraction_not_calibrated_probability",
      },
      lfc: {
        membersWithBoundary: {
          count: 2,
          memberCount: 2,
          fraction: 1,
          interpretation: "raw_member_fraction_not_calibrated_probability",
        },
        pressureHpa: distribution(750),
        geopotentialHeightGpm: distribution(2500),
      },
      el: {
        membersWithBoundary: {
          count: 2,
          memberCount: 2,
          fraction: 1,
          interpretation: "raw_member_fraction_not_calibrated_probability",
        },
        pressureHpa: distribution(400),
        geopotentialHeightGpm: distribution(7000),
      },
    },
    source,
  };
}

describe("IFS ENS diagnostic time series", () => {
  it("preserves the native f144 3h-to-6h transition and pins one run", async () => {
    const getLayerDiagnostics = vi.fn(async (query: { validTime: string }) => {
      const forecastHour = (new Date(query.validTime).getTime() - run.getTime()) / 3_600_000;
      return layerResult(new Date(query.validTime).toISOString(), forecastHour);
    });
    const service = new IfsEnsDiagnosticTimeSeriesService({
      diagnostics: {
        getLayerDiagnostics,
        getProfileDiagnostics: vi.fn(),
        getParcelDiagnostics: vi.fn(),
      } as any,
      stepConcurrency: 2,
    });

    const result = await service.getDiagnosticTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: new Date(run.getTime() + 138 * 3_600_000).toISOString(),
      endTime: new Date(run.getTime() + 156 * 3_600_000).toISOString(),
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate"],
      },
      members: ["p01", "p02"],
      quantiles: [0.5],
      maxSteps: 5,
    });

    expect(result.series.map((step) => step.forecastHour)).toEqual([138, 141, 144, 150, 156]);
    expect(result.cadence).toBe("ecmwf_ens_native_3h_through_f144_then_6h_on_00_12z");
    expect(getLayerDiagnostics).toHaveBeenCalledTimes(5);
    expect(getLayerDiagnostics.mock.calls.every(([query]) => query.run === run.toISOString())).toBe(true);
  });

  it("resolves latest once for the complete member-and-diagnostic selection", async () => {
    const resolveLatestRunForRange = vi.fn(async () => run);
    const getProfileDiagnostics = vi.fn(async (query: { validTime: string }) => {
      const forecastHour = (new Date(query.validTime).getTime() - run.getTime()) / 3_600_000;
      return profileResult(new Date(query.validTime).toISOString(), forecastHour);
    });
    const service = new IfsEnsDiagnosticTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunForRange },
      diagnostics: {
        getLayerDiagnostics: vi.fn(),
        getProfileDiagnostics,
        getParcelDiagnostics: vi.fn(),
      } as any,
    });
    const startTime = new Date(run.getTime() + 3 * 3_600_000);
    const endTime = new Date(run.getTime() + 9 * 3_600_000);

    const result = await service.getDiagnosticTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [925, 850, 700, 500],
        diagnostics: ["freezing_level_crossings"],
      },
      members: ["p01", "p02"],
      quantiles: [0.5],
    });

    expect(resolveLatestRunForRange).toHaveBeenCalledOnce();
    const selectors = resolveLatestRunForRange.mock.calls[0]?.[2] as Array<{ number?: number }>;
    expect(new Set(selectors.map((selector) => selector.number))).toEqual(new Set([1, 2]));
    expect(result.series.map((step) => step.forecastHour)).toEqual([3, 6, 9]);
    expect(result.series.every((step) => step.kind === "profile")).toBe(true);
  });

  it("keeps parcel methodology at the root while compacting each native step", async () => {
    const getParcelDiagnostics = vi.fn(async (query: { validTime: string }) => {
      const forecastHour = (new Date(query.validTime).getTime() - run.getTime()) / 3_600_000;
      return parcelResult(new Date(query.validTime).toISOString(), forecastHour);
    });
    const service = new IfsEnsDiagnosticTimeSeriesService({
      diagnostics: {
        getLayerDiagnostics: vi.fn(),
        getProfileDiagnostics: vi.fn(),
        getParcelDiagnostics,
      } as any,
    });

    const result = await service.getDiagnosticTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: run.toISOString(),
      endTime: new Date(run.getTime() + 3 * 3_600_000).toISOString(),
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [925, 850, 700, 500],
        parcel: "surface_2m",
      },
      members: ["p01", "p02"],
      quantiles: [0.5],
    });

    expect(result.parcelMethodology).toEqual(parcelResult(run.toISOString(), 0).methodology);
    expect(result.series).toHaveLength(2);
    expect(result.series.every((step) => step.kind === "parcel")).toBe(true);
    expect(result.series[0]).not.toHaveProperty("members");
  });

  it("rejects grid drift across diagnostic steps", async () => {
    let call = 0;
    const service = new IfsEnsDiagnosticTimeSeriesService({
      diagnostics: {
        getLayerDiagnostics: async (query: { validTime: string }) => {
          call += 1;
          const forecastHour = (new Date(query.validTime).getTime() - run.getTime()) / 3_600_000;
          const result = layerResult(new Date(query.validTime).toISOString(), forecastHour);
          return call === 2
            ? { ...result, gridPoint: { latitude: 50.25, longitude: 14.5 } }
            : result;
        },
        getProfileDiagnostics: vi.fn(),
        getParcelDiagnostics: vi.fn(),
      } as any,
      stepConcurrency: 1,
    });

    await expect(service.getDiagnosticTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: run.toISOString(),
      endTime: new Date(run.getTime() + 3 * 3_600_000).toISOString(),
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate"],
      },
      members: ["p01", "p02"],
    })).rejects.toThrow("inconsistent grid points");
  });
});
