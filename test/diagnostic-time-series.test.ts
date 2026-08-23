import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DIAGNOSTIC_TIME_SERIES_CONCURRENCY,
  DiagnosticTimeSeriesService,
} from "../src/core/diagnostic-time-series.js";
import type {
  LayerDiagnosticsResult,
  ParcelDiagnosticsResult,
  ProfileDiagnosticsResult,
} from "../src/core/types.js";
import {
  deriveParcelComputation,
  type ParcelEnvironmentLevel,
} from "../src/derived/parcel-diagnostics.js";
import type {
  LayerDiagnosticsQueryInput,
  ParcelDiagnosticsQueryInput,
  ProfileDiagnosticsQueryInput,
} from "../src/schema/query.js";

const run = "2026-08-19T00:00:00.000Z";
const gridPoint = { latitude: 50, longitude: 14.5 };
const requestedPoint = { latitude: 50.08, longitude: 14.43 };

function forecastHour(validTime: string): number {
  return (Date.parse(validTime) - Date.parse(run)) / 3_600_000;
}

function sourceFor(source: "nomads" | "s3" | undefined, cacheHit = false) {
  return source === "nomads"
    ? { provider: "NOAA NOMADS" as const, access: "nomads_grib_filter" as const, decoder: "wgrib2" as const, cacheHit }
    : { provider: "NOAA AWS Open Data" as const, access: "s3_range" as const, decoder: "wgrib2" as const, cacheHit };
}

function layerResult(
  query: LayerDiagnosticsQueryInput,
  overrides: Partial<LayerDiagnosticsResult> = {},
): LayerDiagnosticsResult {
  const validTime = new Date(String(query.validTime)).toISOString();
  const diagnostics = (query.diagnostics ?? []).map((id) => {
    switch (id) {
      case "temperature_lapse_rate":
        return { id, values: { temperatureLapseRateCPerKm: 6.5 } };
      case "wind_shear":
        return { id, values: { uWindShearMs: 2, vWindShearMs: 3, windShearMagnitudeMs: 3.6, windShearMsPerKm: 2.4 } };
      case "potential_temperature_gradient":
        return { id, values: { potentialTemperatureGradientKPerKm: 4.2 } };
    }
  });
  return {
    model: "gfs_0p25",
    run: String(query.run),
    validTime,
    forecastHour: forecastHour(validTime),
    requestedPoint,
    gridPoint,
    layer: {
      lowerPressureHpa: Number(query.lowerPressureHpa),
      upperPressureHpa: Number(query.upperPressureHpa),
      lowerGeopotentialHeightGpm: 1500,
      upperGeopotentialHeightGpm: 3000,
      depthGpm: 1500,
    },
    levels: [
      { pressureHpa: Number(query.lowerPressureHpa), temperatureC: 12, geopotentialHeightGpm: 1500 },
      { pressureHpa: Number(query.upperPressureHpa), temperatureC: 2, geopotentialHeightGpm: 3000 },
    ],
    diagnostics,
    source: sourceFor(query.source, forecastHour(validTime) % 2 === 0),
    ...overrides,
  };
}

function profileResult(query: ProfileDiagnosticsQueryInput): ProfileDiagnosticsResult {
  const validTime = new Date(String(query.validTime)).toISOString();
  const pressureLevels = [...(query.pressureLevelsHpa ?? [])];
  return {
    model: "gfs_0p25",
    run: String(query.run),
    validTime,
    forecastHour: forecastHour(validTime),
    requestedPoint,
    gridPoint,
    sampledPressureLevelsHpa: pressureLevels,
    levels: pressureLevels.map((pressureHpa, index) => ({
      pressureHpa,
      temperatureC: 10 - index * 5,
      geopotentialHeightGpm: 1000 + index * 1000,
    })),
    diagnostics: (query.diagnostics ?? []).map((id) => id === "freezing_level_crossings"
      ? { id, crossings: [] }
      : { id, layers: [] }),
    source: sourceFor(query.source),
  };
}

const parcelSurface: ParcelEnvironmentLevel = {
  pressureHpa: 1000,
  geopotentialHeightGpm: 100,
  temperatureC: 30,
  specificHumidityKgKg: 0.018,
};
const parcelLevels: ParcelEnvironmentLevel[] = [
  { pressureHpa: 950, geopotentialHeightGpm: 550, temperatureC: 27, specificHumidityKgKg: 0.015 },
  { pressureHpa: 900, geopotentialHeightGpm: 1000, temperatureC: 23, specificHumidityKgKg: 0.012 },
  { pressureHpa: 850, geopotentialHeightGpm: 1500, temperatureC: 14, specificHumidityKgKg: 0.009 },
  { pressureHpa: 800, geopotentialHeightGpm: 2000, temperatureC: 9, specificHumidityKgKg: 0.007 },
  { pressureHpa: 700, geopotentialHeightGpm: 3000, temperatureC: 0, specificHumidityKgKg: 0.004 },
  { pressureHpa: 600, geopotentialHeightGpm: 4200, temperatureC: -10, specificHumidityKgKg: 0.002 },
  { pressureHpa: 500, geopotentialHeightGpm: 5600, temperatureC: -22, specificHumidityKgKg: 0.001 },
  { pressureHpa: 400, geopotentialHeightGpm: 7200, temperatureC: -32, specificHumidityKgKg: 0.0006 },
  { pressureHpa: 300, geopotentialHeightGpm: 9200, temperatureC: -38, specificHumidityKgKg: 0.0003 },
  { pressureHpa: 250, geopotentialHeightGpm: 10400, temperatureC: -25, specificHumidityKgKg: 0.0002 },
];

function parcelResult(query: ParcelDiagnosticsQueryInput): ParcelDiagnosticsResult {
  const validTime = new Date(String(query.validTime)).toISOString();
  return {
    model: "gfs_0p25",
    run: String(query.run),
    validTime,
    forecastHour: forecastHour(validTime),
    requestedPoint,
    gridPoint,
    sampledPressureLevelsHpa: parcelLevels.map((level) => level.pressureHpa),
    levels: parcelLevels.map((level) => ({ ...level })),
    parcel: deriveParcelComputation(query.parcel ?? "surface_2m", parcelSurface, parcelLevels),
    source: sourceFor(query.source),
  };
}

const layerBase = {
  latitude: requestedPoint.latitude,
  longitude: requestedPoint.longitude,
  run,
  startTime: "2026-08-23T22:00:00Z",
  endTime: "2026-08-24T06:00:00Z",
  diagnostic: {
    kind: "layer" as const,
    lowerPressureHpa: 850,
    upperPressureHpa: 700,
    diagnostics: ["temperature_lapse_rate" as const],
  },
};

describe("DiagnosticTimeSeriesService", () => {
  it("uses native cadence across f120 and returns compact ordered layer steps", async () => {
    const getLayerDiagnostics = vi.fn(async (query: LayerDiagnosticsQueryInput) => layerResult(query));
    const service = new DiagnosticTimeSeriesService({
      layerDiagnosticsGetter: { getLayerDiagnostics },
      concurrency: 3,
    });
    const result = await service.getDiagnosticTimeSeries({
      ...layerBase,
      diagnostic: { ...layerBase.diagnostic, diagnostics: ["temperature_lapse_rate", "temperature_lapse_rate"] },
    });

    expect(result.series.map((step) => step.forecastHour)).toEqual([118, 119, 120, 123, 126]);
    expect(result.diagnostic).toEqual({
      kind: "layer",
      lowerPressureHpa: 850,
      upperPressureHpa: 700,
      diagnostics: ["temperature_lapse_rate"],
    });
    expect(result.source).toEqual({ provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2" });
    expect(result.series.every((step) => step.kind === "layer")).toBe(true);
    expect(getLayerDiagnostics.mock.calls.every(([query]) => query.run === run && query.source === "s3")).toBe(true);
  });

  it("composes whole-profile diagnostics and normalizes duplicate pressure levels", async () => {
    const getProfileDiagnostics = vi.fn(async (query: ProfileDiagnosticsQueryInput) => profileResult(query));
    const service = new DiagnosticTimeSeriesService({ profileDiagnosticsGetter: { getProfileDiagnostics } });
    const result = await service.getDiagnosticTimeSeries({
      latitude: requestedPoint.latitude,
      longitude: requestedPoint.longitude,
      run,
      startTime: "2026-08-19T00:00:00Z",
      endTime: "2026-08-19T01:00:00Z",
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 925, 850, 850, 700],
        diagnostics: ["freezing_level_crossings", "temperature_inversion_layers", "freezing_level_crossings"],
      },
    });

    expect(result.diagnostic).toEqual({
      kind: "profile",
      pressureLevelsHpa: [1000, 925, 850, 700],
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
    });
    expect(result.series).toHaveLength(2);
    expect(result.series[0]?.kind).toBe("profile");
    expect(getProfileDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      pressureLevelsHpa: [1000, 925, 850, 700],
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
    }));
  });

  it("returns compact parcel state without repeating the full parcel path", async () => {
    const getParcelDiagnostics = vi.fn(async (query: ParcelDiagnosticsQueryInput) => parcelResult(query));
    const service = new DiagnosticTimeSeriesService({ parcelDiagnosticsGetter: { getParcelDiagnostics } });
    const result = await service.getDiagnosticTimeSeries({
      latitude: requestedPoint.latitude,
      longitude: requestedPoint.longitude,
      run,
      startTime: "2026-08-19T00:00:00Z",
      endTime: "2026-08-19T00:00:00Z",
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [950, 900, 850, 800, 700, 600, 500, 400, 300, 250],
        parcel: "surface_2m",
      },
    });

    const step = result.series[0];
    expect(step?.kind).toBe("parcel");
    if (!step || step.kind !== "parcel") throw new Error("Expected parcel step");
    expect(step.parcel.capeJkg).toBeGreaterThanOrEqual(0);
    expect(step.parcel).not.toHaveProperty("parcelPath");
    expect(step.parcel.startingState.definition).toBe("surface_2m");
  });

  it("resolves query-aware latest once with exact layer dependencies for the whole range", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(run));
    const getLayerDiagnostics = vi.fn(async (query: LayerDiagnosticsQueryInput) => layerResult(query));
    const service = new DiagnosticTimeSeriesService({
      latestRunProvider: { resolveLatestRun },
      layerDiagnosticsGetter: { getLayerDiagnostics },
    });
    await service.getDiagnosticTimeSeries({ ...layerBase, run: "latest" });

    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(resolveLatestRun).toHaveBeenCalledWith({
      type: "time_range",
      startTime: new Date(layerBase.startTime),
      endTime: new Date(layerBase.endTime),
      selection: {
        variableCodes: ["TMP", "HGT"],
        pressureLevelsHpa: [850, 700],
        fields: [],
      },
    });
    expect(getLayerDiagnostics.mock.calls.every(([query]) => query.run === run)).toBe(true);
  });

  it("includes parcel surface dependencies when resolving latest", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(run));
    const getParcelDiagnostics = vi.fn(async (query: ParcelDiagnosticsQueryInput) => parcelResult(query));
    const service = new DiagnosticTimeSeriesService({
      latestRunProvider: { resolveLatestRun },
      parcelDiagnosticsGetter: { getParcelDiagnostics },
    });
    await service.getDiagnosticTimeSeries({
      latitude: requestedPoint.latitude,
      longitude: requestedPoint.longitude,
      run: "latest",
      startTime: "2026-08-19T00:00:00Z",
      endTime: "2026-08-19T00:00:00Z",
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [950, 900, 850, 800, 700, 600, 500, 400, 300, 250],
        parcel: "surface_2m",
      },
    });

    const requirement = resolveLatestRun.mock.calls[0]?.[0];
    if (!requirement || requirement.type !== "time_range") throw new Error("Expected time-range latest requirement");
    expect(requirement.selection.variableCodes).toEqual(["TMP", "SPFH", "HGT"]);
    expect(requirement.selection.fields.map((field) => field.id)).toEqual([
      "surface_pressure",
      "surface_geopotential_height",
      "temperature_2m",
      "specific_humidity_2m",
    ]);
  });

  it("resolves profile dependencies for query-aware latest", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(run));
    const getProfileDiagnostics = vi.fn(async (query: ProfileDiagnosticsQueryInput) => profileResult(query));
    const service = new DiagnosticTimeSeriesService({
      latestRunProvider: { resolveLatestRun },
      profileDiagnosticsGetter: { getProfileDiagnostics },
    });
    await service.getDiagnosticTimeSeries({
      latitude: requestedPoint.latitude,
      longitude: requestedPoint.longitude,
      run: "latest",
      startTime: "2026-08-19T00:00:00Z",
      endTime: "2026-08-19T00:00:00Z",
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700, 500],
        diagnostics: ["temperature_inversion_layers"],
      },
    });
    const requirement = resolveLatestRun.mock.calls[0]?.[0];
    if (!requirement || requirement.type !== "time_range") throw new Error("Expected time-range latest requirement");
    expect(requirement.selection).toEqual({
      variableCodes: ["TMP", "HGT"],
      pressureLevelsHpa: [850, 700, 500],
      fields: [],
    });
  });

  it("uses complete-run discovery for latest_complete and skips discovery for explicit runs", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(run));
    const getLayerDiagnostics = vi.fn(async (query: LayerDiagnosticsQueryInput) => layerResult(query));
    const service = new DiagnosticTimeSeriesService({
      latestRunProvider: { resolveLatestRun },
      layerDiagnosticsGetter: { getLayerDiagnostics },
    });

    await service.getDiagnosticTimeSeries({ ...layerBase, run: "latest_complete" });
    expect(resolveLatestRun).toHaveBeenCalledWith();
    resolveLatestRun.mockClear();

    await service.getDiagnosticTimeSeries(layerBase);
    expect(resolveLatestRun).not.toHaveBeenCalled();
  });

  it("fails before diagnostic access when maxSteps is exceeded", async () => {
    const getLayerDiagnostics = vi.fn(async (query: LayerDiagnosticsQueryInput) => layerResult(query));
    const service = new DiagnosticTimeSeriesService({ layerDiagnosticsGetter: { getLayerDiagnostics } });
    await expect(service.getDiagnosticTimeSeries({ ...layerBase, maxSteps: 2 })).rejects.toThrow(
      /5 native GFS outputs.*maxSteps=2/,
    );
    expect(getLayerDiagnostics).not.toHaveBeenCalled();
  });

  it("supports explicit NOMADS provenance", async () => {
    const getLayerDiagnostics = vi.fn(async (query: LayerDiagnosticsQueryInput) => layerResult(query));
    const service = new DiagnosticTimeSeriesService({ layerDiagnosticsGetter: { getLayerDiagnostics } });
    const result = await service.getDiagnosticTimeSeries({
      ...layerBase,
      endTime: "2026-08-23T22:00:00Z",
      source: "nomads",
    });
    expect(result.source).toEqual({ provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2" });
  });

  it("normalizes offset timestamps in the result", async () => {
    const getLayerDiagnostics = vi.fn(async (query: LayerDiagnosticsQueryInput) => layerResult(query));
    const service = new DiagnosticTimeSeriesService({ layerDiagnosticsGetter: { getLayerDiagnostics } });
    const result = await service.getDiagnosticTimeSeries({
      ...layerBase,
      startTime: "2026-08-24T00:00:00+02:00",
      endTime: "2026-08-24T01:00:00+02:00",
    });
    expect(result.requestedStartTime).toBe("2026-08-23T22:00:00.000Z");
    expect(result.requestedEndTime).toBe("2026-08-23T23:00:00.000Z");
  });

  it("bounds concurrent diagnostic operations", async () => {
    let active = 0;
    let maxActive = 0;
    const getLayerDiagnostics = vi.fn(async (query: LayerDiagnosticsQueryInput) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return layerResult(query);
    });
    const service = new DiagnosticTimeSeriesService({
      layerDiagnosticsGetter: { getLayerDiagnostics },
      concurrency: 2,
    });
    await service.getDiagnosticTimeSeries({
      ...layerBase,
      startTime: "2026-08-19T00:00:00Z",
      endTime: "2026-08-19T05:00:00Z",
    });
    expect(maxActive).toBe(2);
  });

  it("rejects run, time, grid-point, and source changes within one series", async () => {
    const variants: Array<[string, Partial<LayerDiagnosticsResult>, RegExp]> = [
      ["run", { run: "2026-08-18T18:00:00.000Z" }, /run changed/],
      ["time", { forecastHour: 999 }, /result time changed/],
      ["grid", { gridPoint: { latitude: 49.75, longitude: 14.5 } }, /grid point changed/],
      ["source", { source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false } }, /Data source changed/],
    ];

    for (const [, overrides, message] of variants) {
      let call = 0;
      const getLayerDiagnostics = vi.fn(async (query: LayerDiagnosticsQueryInput) => {
        call += 1;
        return layerResult(query, call === 2 ? overrides : {});
      });
      const service = new DiagnosticTimeSeriesService({ layerDiagnosticsGetter: { getLayerDiagnostics } });
      await expect(service.getDiagnosticTimeSeries({
        ...layerBase,
        startTime: "2026-08-19T00:00:00Z",
        endTime: "2026-08-19T01:00:00Z",
      })).rejects.toThrow(message);
    }
  });

  it("propagates underlying diagnostic failures", async () => {
    const service = new DiagnosticTimeSeriesService({
      layerDiagnosticsGetter: { getLayerDiagnostics: async () => { throw new Error("range download failed"); } },
    });
    await expect(service.getDiagnosticTimeSeries({
      ...layerBase,
      endTime: "2026-08-23T22:00:00Z",
    })).rejects.toThrow("range download failed");
  });

  it("keeps the same default bounded concurrency as point time series", () => {
    expect(DEFAULT_DIAGNOSTIC_TIME_SERIES_CONCURRENCY).toBe(4);
    expect(new DiagnosticTimeSeriesService()).toBeInstanceOf(DiagnosticTimeSeriesService);
  });
});
