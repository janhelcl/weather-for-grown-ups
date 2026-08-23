import { describe, expect, it, vi } from "vitest";
import { AreaSummaryService } from "../src/core/area-summary.js";

const base = {
  westLongitude: 12,
  eastLongitude: 13,
  southLatitude: 48,
  northLatitude: 49,
  run: "2026-08-24T06:00:00Z",
  validTime: "2026-08-24T12:00:00Z",
  variable: "temperature" as const,
  pressureLevelHpa: 850,
};

const rawTemperaturePoints = [
  { longitude: 12, latitude: 48, value: 273.15 },
  { longitude: 12.25, latitude: 48, value: 283.15 },
  { longitude: 12.5, latitude: 48, value: 293.15 },
  { longitude: 12.75, latitude: 48, value: 293.15 },
];

function harness() {
  const fetch = vi.fn(async () => ({ path: "/cache/area.grib2", cacheHit: false }));
  const summarizeBox = vi.fn(async () => ({
    totalGridPoints: 4, undefinedGridPoints: 0, definedGridPoints: 4,
    mean: 285.65, min: 273.15, max: 293.15,
  }));
  const summarizeSelectedMessage = vi.fn(async () => ({
    totalGridPoints: 4, undefinedGridPoints: 0, definedGridPoints: 4,
    mean: 50, min: 20, max: 80,
    temporal: { type: "average" as const, startForecastHour: 0, endForecastHour: 6 },
  }));
  const extractBox = vi.fn(async () => rawTemperaturePoints);
  const extractSelectedMessage = vi.fn(async () => ({
    points: [
      { longitude: 12, latitude: 48, value: 20 },
      { longitude: 12.25, latitude: 48, value: 40 },
      { longitude: 12.5, latitude: 48, value: 60 },
      { longitude: 12.75, latitude: 48, value: 80 },
    ],
    temporal: { type: "average" as const, startForecastHour: 0, endForecastHour: 6 },
  }));
  const service = new AreaSummaryService({
    cache: { fetch },
    decoder: { summarizeBox, summarizeSelectedMessage },
    gridDecoder: { extractBox, extractSelectedMessage },
    latestRunProvider: { resolveLatestRun: vi.fn(async () => new Date("2026-08-24T06:00:00Z")) },
  });
  return { service, fetch, summarizeBox, summarizeSelectedMessage, extractBox, extractSelectedMessage };
}

describe("AreaSummaryService rich distribution path", () => {
  it("keeps ordinary area summaries on the fast -stats decoder", async () => {
    const { service, summarizeBox, extractBox } = harness();
    const result = await service.summarize(base);
    expect(summarizeBox).toHaveBeenCalledOnce();
    expect(extractBox).not.toHaveBeenCalled();
    expect(result.distribution).toBeUndefined();
    expect(result.statistics).toMatchObject({ mean: 12.5, min: 0, max: 20 });
  });

  it("normalizes temperature grid values before percentiles and thresholds", async () => {
    const { service, summarizeBox, extractBox } = harness();
    const result = await service.summarize({
      ...base,
      percentiles: [50, 90],
      thresholds: [{ operator: "gte", value: 15 }],
      includeExtremaLocations: true,
    });

    expect(summarizeBox).not.toHaveBeenCalled();
    expect(extractBox).toHaveBeenCalledOnce();
    expect(result.statistics).toEqual({
      definedGridPoints: 4,
      mean: 12.5,
      min: 0,
      max: 20,
      meanKind: "unweighted_grid_point_mean",
    });
    expect(result.distribution).toEqual({
      percentileMethod: "linear_interpolation_sorted_defined_grid_points",
      percentiles: [
        { percentile: 50, value: 15 },
        { percentile: 90, value: 20 },
      ],
      thresholdFractions: [
        { operator: "gte", threshold: 15, matchingGridPoints: 2, fraction: 0.5 },
      ],
      extrema: {
        min: { value: 0, gridPoint: { latitude: 48, longitude: 12 }, tiedGridPoints: 1 },
        max: { value: 20, gridPoint: { latitude: 48, longitude: 12.5 }, tiedGridPoints: 2 },
      },
    });
  });

  it("uses exact selected-message extraction for rich non-isobaric summaries", async () => {
    const { service, summarizeSelectedMessage, extractSelectedMessage } = harness();
    const result = await service.summarize({
      westLongitude: 12,
      eastLongitude: 13,
      southLatitude: 48,
      northLatitude: 49,
      run: "2026-08-24T06:00:00Z",
      validTime: "2026-08-24T12:00:00Z",
      field: "low_cloud_cover_average",
      percentiles: [50],
      thresholds: [{ operator: "lte", value: 50 }],
    });

    expect(summarizeSelectedMessage).not.toHaveBeenCalled();
    expect(extractSelectedMessage).toHaveBeenCalledWith("/cache/area.grib2", expect.any(Object), {
      code: "LCDC",
      gribLevel: "low cloud layer",
      temporalSemantics: "average",
    });
    expect(result.field?.temporal).toEqual({
      type: "average",
      startForecastHour: 0,
      endForecastHour: 6,
      startTime: "2026-08-24T06:00:00.000Z",
      endTime: "2026-08-24T12:00:00.000Z",
    });
    expect(result.statistics).toMatchObject({ mean: 50, min: 20, max: 80 });
    expect(result.distribution?.percentiles).toEqual([{ percentile: 50, value: 50 }]);
    expect(result.distribution?.thresholdFractions).toEqual([
      { operator: "lte", threshold: 50, matchingGridPoints: 2, fraction: 0.5 },
    ]);
  });
});
