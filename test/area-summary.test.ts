import { describe, expect, it, vi } from "vitest";
import { AreaSummaryService, estimateGridPoints } from "../src/core/area-summary.js";

const base = {
  westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
  run: "2026-08-19T06:00:00Z", validTime: "2026-08-19T12:00:00Z",
  variable: "temperature" as const, pressureLevelHpa: 850,
};
const rawStats = { totalGridPoints: 400, undefinedGridPoints: 100, definedGridPoints: 300, mean: 285.15, min: 275.15, max: 295.15 };

function harness(
  stats = rawStats,
  cacheHit = false,
  selectedStats = { ...rawStats, temporal: { type: "instantaneous" as const } },
) {
  const fetch = vi.fn(async (_url: string) => ({ path: "/cache/area.grib2", cacheHit }));
  const summarizeBox = vi.fn(async () => stats);
  const summarizeSelectedMessage = vi.fn(async () => selectedStats);
  const resolveLatestRun = vi.fn(async () => new Date("2026-08-19T06:00:00Z"));
  const service = new AreaSummaryService({
    cache: { fetch },
    decoder: { summarizeBox, summarizeSelectedMessage },
    latestRunProvider: { resolveLatestRun },
  });
  return { service, fetch, summarizeBox, summarizeSelectedMessage, resolveLatestRun };
}

describe("estimateGridPoints", () => {
  it("conservatively estimates 0.25-degree grid coverage", () => {
    expect(estimateGridPoints({ westLongitude: 0, eastLongitude: 1, southLatitude: 0, northLatitude: 1 })).toBe(36);
  });
});

describe("AreaSummaryService", () => {
  it("fetches one NOMADS subset, computes pressure stats, converts temperature to Celsius, and reports provenance", async () => {
    const { service, fetch, summarizeBox, resolveLatestRun } = harness();
    const result = await service.summarize(base);
    expect(resolveLatestRun).not.toHaveBeenCalled();
    expect(result).toEqual({
      model: "gfs_0p25", run: "2026-08-19T06:00:00.000Z", validTime: "2026-08-19T12:00:00.000Z", forecastHour: 6,
      bbox: { westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51 },
      variable: { id: "temperature", pressureHpa: 850, field: "temperatureC", unit: "degC" },
      statistics: { definedGridPoints: 300, mean: 12, min: 2, max: 22, meanKind: "unweighted_grid_point_mean" },
      source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false },
    });
    const url = new URL(fetch.mock.calls[0]?.[0] ?? "");
    expect(url.searchParams.get("var_TMP")).toBe("on");
    expect(url.searchParams.get("lev_850_mb")).toBe("on");
    expect(summarizeBox).toHaveBeenCalledWith("/cache/area.grib2", result.bbox);
  });

  it("leaves non-temperature pressure units unchanged", async () => {
    const { service } = harness({ ...rawStats, mean: -0.2, min: -1, max: 0.5 });
    const result = await service.summarize({ ...base, variable: "vertical_velocity" });
    expect(result.variable).toMatchObject({ field: "verticalVelocityPaS", unit: "Pa/s" });
    expect(result.statistics).toMatchObject({ mean: -0.2, min: -1, max: 0.5 });
  });

  it("summarizes an instantaneous 2 m temperature field with exact message selection and Celsius conversion", async () => {
    const selected = {
      totalGridPoints: 400,
      undefinedGridPoints: 40,
      definedGridPoints: 360,
      mean: 285.15,
      min: 275.15,
      max: 295.15,
      temporal: { type: "instantaneous" as const },
    };
    const { service, fetch, summarizeBox, summarizeSelectedMessage } = harness(rawStats, false, selected);
    const result = await service.summarize({
      westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
      run: "2026-08-19T06:00:00Z", validTime: "2026-08-19T12:00:00Z",
      field: "temperature_2m",
    });

    expect(result).toMatchObject({
      field: {
        id: "temperature_2m",
        level: { type: "height_above_ground_m", heightM: 2 },
        temporal: { type: "instantaneous" },
        output: { field: "temperatureC", unit: "degC" },
      },
      statistics: { definedGridPoints: 360, mean: 12, min: 2, max: 22 },
    });
    expect(result.variable).toBeUndefined();
    expect(summarizeBox).not.toHaveBeenCalled();
    expect(summarizeSelectedMessage).toHaveBeenCalledWith(
      "/cache/area.grib2",
      result.bbox,
      { code: "TMP", gribLevel: "2 m above ground", temporalSemantics: "instantaneous" },
    );
    const url = new URL(fetch.mock.calls[0]?.[0] ?? "");
    expect(url.searchParams.get("var_TMP")).toBe("on");
    expect(url.searchParams.get("lev_2_m_above_ground")).toBe("on");
    expect(url.searchParams.has("lev_850_mb")).toBe(false);
  });

  it("preserves average temporal semantics with absolute UTC interval times", async () => {
    const selected = {
      totalGridPoints: 400,
      undefinedGridPoints: 20,
      definedGridPoints: 380,
      mean: 55,
      min: 10,
      max: 100,
      temporal: { type: "average" as const, startForecastHour: 3, endForecastHour: 6 },
    };
    const { service } = harness(rawStats, false, selected);
    const result = await service.summarize({
      westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
      run: "2026-08-19T06:00:00Z", validTime: "2026-08-19T12:00:00Z",
      field: "low_cloud_cover_average",
    });
    expect(result.field).toEqual({
      id: "low_cloud_cover_average",
      level: { type: "named_layer", id: "low_cloud_layer" },
      temporal: {
        type: "average",
        startForecastHour: 3,
        endForecastHour: 6,
        startTime: "2026-08-19T09:00:00.000Z",
        endTime: "2026-08-19T12:00:00.000Z",
      },
      output: { field: "cloudCoverPct", unit: "%" },
    });
    expect(result.statistics).toMatchObject({ mean: 55, min: 10, max: 100 });
  });

  it("preserves accumulation semantics and mm output for total precipitation", async () => {
    const selected = {
      totalGridPoints: 400,
      undefinedGridPoints: 0,
      definedGridPoints: 400,
      mean: 2.5,
      min: 0,
      max: 12,
      temporal: { type: "accumulation" as const, startForecastHour: 0, endForecastHour: 6 },
    };
    const { service } = harness(rawStats, false, selected);
    const result = await service.summarize({
      westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
      run: "2026-08-19T06:00:00Z", validTime: "2026-08-19T12:00:00Z",
      field: "total_precipitation",
    });
    expect(result.field).toMatchObject({
      id: "total_precipitation",
      temporal: {
        type: "accumulation",
        startForecastHour: 0,
        endForecastHour: 6,
        startTime: "2026-08-19T06:00:00.000Z",
        endTime: "2026-08-19T12:00:00.000Z",
      },
      output: { field: "totalPrecipitationMm", unit: "mm" },
    });
    expect(result.statistics).toMatchObject({ mean: 2.5, min: 0, max: 12 });
  });

  it("resolves latest against the exact pressure variable, level, and valid time", async () => {
    const { service, resolveLatestRun } = harness();
    const result = await service.summarize({ ...base, run: "latest" });
    expect(resolveLatestRun).toHaveBeenCalledWith({
      type: "valid_time",
      validTime: new Date("2026-08-19T12:00:00Z"),
      selection: {
        variableCodes: ["TMP"],
        pressureLevelsHpa: [850],
        fields: [],
      },
    });
    expect(result.run).toBe("2026-08-19T06:00:00.000Z");
  });

  it("resolves latest against the exact raw non-isobaric field semantics", async () => {
    const { service, resolveLatestRun } = harness();
    await service.summarize({
      westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
      run: "latest", validTime: "2026-08-19T12:00:00Z", field: "low_cloud_cover_average",
    });
    expect(resolveLatestRun).toHaveBeenCalledOnce();
    const requirement = resolveLatestRun.mock.calls[0]?.[0];
    expect(requirement).toMatchObject({
      type: "valid_time",
      validTime: new Date("2026-08-19T12:00:00Z"),
      selection: { variableCodes: [], pressureLevelsHpa: [] },
    });
    expect(requirement?.selection.fields).toHaveLength(1);
    expect(requirement?.selection.fields[0]).toMatchObject({
      id: "low_cloud_cover_average",
      gfsCode: "LCDC",
      temporalSemantics: "average",
      level: { gribLevel: "low cloud layer" },
    });
  });

  it("uses complete-run discovery for latest_complete", async () => {
    const { service, resolveLatestRun } = harness();
    await service.summarize({ ...base, run: "latest_complete" });
    expect(resolveLatestRun).toHaveBeenCalledWith();
  });

  it("propagates cache-hit provenance", async () => {
    expect((await harness(rawStats, true).service.summarize(base)).source.cacheHit).toBe(true);
  });

  it("rejects oversized areas before run discovery or NOMADS access", async () => {
    const { service, fetch, resolveLatestRun } = harness();
    await expect(service.summarize({
      ...base, run: "latest", westLongitude: -100, eastLongitude: 100, southLatitude: -50, northLatitude: 50, maxGridPoints: 100,
    })).rejects.toThrow(/exceeding maxGridPoints=100/);
    expect(resolveLatestRun).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid bbox and derived non-isobaric fields before dependencies", async () => {
    const { service, fetch } = harness();
    await expect(service.summarize({ ...base, eastLongitude: 10 })).rejects.toThrow();
    await expect(service.summarize({
      westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
      validTime: "2026-08-19T12:00:00Z", field: "wind_10m",
    })).rejects.toThrow(/raw non-isobaric fields only/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
