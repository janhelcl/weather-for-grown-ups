import { describe, expect, it, vi } from "vitest";
import { IfsDiagnosticTimeSeriesService } from "../src/core/ifs-diagnostic-timeseries.js";
import { IfsDiagnosticsService } from "../src/core/ifs-diagnostics.js";
import type { IfsPointQueryInput, IfsProfileResult } from "../src/schema/ifs.js";

const run = new Date("2026-08-27T12:00:00Z");
const source = {
  provider: "ECMWF Open Data" as const,
  access: "indexed_http_range" as const,
  decoder: "gribberish" as const,
  product: "ifs_0p25_oper_fc" as const,
  horizontalGridDegrees: 0.25 as const,
  cacheHit: true,
};
const requestedPoint = { latitude: 50.08, longitude: 14.43 };
const gridPoint = { latitude: 50, longitude: 14.5 };

describe("IFS diagnostic time series", () => {
  it("preserves native IFS cadence and pins one selection-capable run", async () => {
    const resolveLatestRunForRange = vi.fn(async () => run);
    const getLayerDiagnostics = vi.fn(async (query: any) => ({
      model: "ifs_0p25" as const,
      run: run.toISOString(),
      validTime: new Date(query.validTime).toISOString(),
      forecastHour: (new Date(query.validTime).getTime() - run.getTime()) / 3_600_000,
      requestedPoint,
      gridPoint,
      layer: {
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        lowerGeopotentialHeightGpm: 1500,
        upperGeopotentialHeightGpm: 5500,
        depthGpm: 4000,
      },
      levels: [
        { pressureHpa: 850, geopotentialHeightGpm: 1500, temperatureC: 10 },
        { pressureHpa: 500, geopotentialHeightGpm: 5500, temperatureC: -15 },
      ],
      diagnostics: [{
        id: "temperature_lapse_rate" as const,
        values: { temperatureLapseRateCPerKm: 6.25 },
      }],
      source,
    }));
    const service = new IfsDiagnosticTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunForRange },
      diagnostics: {
        getLayerDiagnostics,
        getProfileDiagnostics: vi.fn(),
        getParcelDiagnostics: vi.fn(),
      } as any,
      concurrency: 1,
    });

    const result = await service.getDiagnosticTimeSeries({
      latitude: requestedPoint.latitude,
      longitude: requestedPoint.longitude,
      run: "latest",
      startTime: "2026-08-27T12:00:00Z",
      endTime: "2026-08-27T18:00:00Z",
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate"],
      },
    });

    expect(resolveLatestRunForRange).toHaveBeenCalledOnce();
    expect(result.run).toBe(run.toISOString());
    expect(result.series.map((step) => step.forecastHour)).toEqual([0, 3, 6]);
    expect(result.series.every((step) => step.kind === "layer")).toBe(true);
    expect(getLayerDiagnostics).toHaveBeenCalledTimes(3);
  });

  it("includes run-static surface geopotential when resolving a parcel range", async () => {
    const resolveLatestRunForRange = vi.fn(async (
      _startTime: Date,
      _endTime: Date,
      selectors: readonly any[],
    ) => {
      expect(selectors).toEqual(expect.arrayContaining([
        expect.objectContaining({
          param: "z",
          levtype: "sfc",
          sourceForecastHour: 0,
        }),
      ]));
      return run;
    });

    const getProfile = vi.fn(async (query: IfsPointQueryInput): Promise<IfsProfileResult> => ({
      model: "ifs_0p25",
      run: run.toISOString(),
      validTime: new Date(String(query.validTime)).toISOString(),
      forecastHour: (new Date(String(query.validTime)).getTime() - run.getTime()) / 3_600_000,
      requestedPoint,
      gridPoint,
      levels: [
        { pressureHpa: 925, geopotentialHeightGpm: 800, temperatureC: 24, specificHumidityKgKg: 0.014 },
        { pressureHpa: 850, geopotentialHeightGpm: 1500, temperatureC: 14, specificHumidityKgKg: 0.009 },
        { pressureHpa: 700, geopotentialHeightGpm: 3000, temperatureC: 0, specificHumidityKgKg: 0.004 },
        { pressureHpa: 500, geopotentialHeightGpm: 5600, temperatureC: -22, specificHumidityKgKg: 0.001 },
        { pressureHpa: 300, geopotentialHeightGpm: 9200, temperatureC: -38, specificHumidityKgKg: 0.0003 },
      ],
      fields: [
        { id: "surface_pressure", level: { type: "surface" }, temporal: { type: "instantaneous" }, values: { pressurePa: 100000 } },
        { id: "surface_geopotential_height", level: { type: "surface" }, temporal: { type: "instantaneous" }, values: { geopotentialHeightGpm: 100 } },
        { id: "temperature_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { temperatureC: 30 } },
        { id: "specific_humidity_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { specificHumidityKgKg: 0.018 } },
      ],
      source,
    }));
    const diagnostics = new IfsDiagnosticsService({ profileGetter: { getProfile } });
    const service = new IfsDiagnosticTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunForRange },
      diagnostics,
      concurrency: 1,
    });

    const result = await service.getDiagnosticTimeSeries({
      latitude: requestedPoint.latitude,
      longitude: requestedPoint.longitude,
      run: "latest",
      startTime: "2026-08-27T12:00:00Z",
      endTime: "2026-08-27T18:00:00Z",
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [925, 850, 700, 500, 300],
        parcel: "surface_2m",
      },
    });

    expect(result.series.map((step) => step.forecastHour)).toEqual([0, 3, 6]);
    const first = result.series[0];
    expect(first?.kind).toBe("parcel");
    if (first?.kind === "parcel") {
      expect(first.parcel.startingState.definition).toBe("surface_2m");
      expect("parcelPath" in first.parcel).toBe(false);
    }
    expect(getProfile).toHaveBeenCalledTimes(3);
  });

  it("rejects non-native pressure levels and duplicate diagnostic selections", async () => {
    const service = new IfsDiagnosticTimeSeriesService();
    await expect(service.getDiagnosticTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: "2026-08-27T12:00:00Z",
      endTime: "2026-08-27T18:00:00Z",
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 975],
        diagnostics: ["freezing_level_crossings"],
      },
    })).rejects.toThrow("not published by the ECMWF IFS");

    await expect(service.getDiagnosticTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: "2026-08-27T12:00:00Z",
      endTime: "2026-08-27T18:00:00Z",
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear", "wind_shear"],
      },
    })).rejects.toThrow("must not contain duplicates");
  });
});
