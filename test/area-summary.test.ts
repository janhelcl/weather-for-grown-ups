import { describe, expect, it, vi } from "vitest";
import { AreaSummaryService, estimateGridPoints } from "../src/core/area-summary.js";

const base = {
  westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
  run: "2026-08-19T06:00:00Z", validTime: "2026-08-19T12:00:00Z",
  variable: "temperature" as const, pressureLevelHpa: 850,
};
const rawStats = { totalGridPoints: 400, undefinedGridPoints: 100, definedGridPoints: 300, mean: 285.15, min: 275.15, max: 295.15 };

function harness(stats = rawStats, cacheHit = false) {
  const fetch = vi.fn(async (_url: string) => ({ path: "/cache/area.grib2", cacheHit }));
  const summarizeBox = vi.fn(async () => stats);
  const resolveLatestRun = vi.fn(async () => new Date("2026-08-19T06:00:00Z"));
  const service = new AreaSummaryService({ cache: { fetch }, decoder: { summarizeBox }, latestRunProvider: { resolveLatestRun } });
  return { service, fetch, summarizeBox, resolveLatestRun };
}

describe("estimateGridPoints", () => {
  it("conservatively estimates 0.25-degree grid coverage", () => {
    expect(estimateGridPoints({ westLongitude: 0, eastLongitude: 1, southLatitude: 0, northLatitude: 1 })).toBe(36);
  });
});

describe("AreaSummaryService", () => {
  it("fetches one NOMADS subset, computes stats, converts temperature to Celsius, and reports provenance", async () => {
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

  it("leaves non-temperature raw units unchanged", async () => {
    const { service } = harness({ ...rawStats, mean: -0.2, min: -1, max: 0.5 });
    const result = await service.summarize({ ...base, variable: "vertical_velocity" });
    expect(result.variable).toMatchObject({ field: "verticalVelocityPaS", unit: "Pa/s" });
    expect(result.statistics).toMatchObject({ mean: -0.2, min: -1, max: 0.5 });
  });

  it("resolves latest once when requested", async () => {
    const { service, resolveLatestRun } = harness();
    const result = await service.summarize({ ...base, run: "latest" });
    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(result.run).toBe("2026-08-19T06:00:00.000Z");
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

  it("validates invalid bbox and derived variables before dependencies", async () => {
    const { service, fetch } = harness();
    await expect(service.summarize({ ...base, eastLongitude: 10 })).rejects.toThrow();
    await expect(service.summarize({ ...base, variable: "wind" as never })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
