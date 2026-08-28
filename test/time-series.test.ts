import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TIME_SERIES_CONCURRENCY, TimeSeriesService } from "../src/core/time-series.js";
import type { ProfileResult } from "../src/core/types.js";
import type { ProfileQueryInput } from "../src/schema/query.js";

const run = "2026-08-19T00:00:00.000Z";
const gridPoint = { latitude: 50, longitude: 14.5 };

function profileFor(query: ProfileQueryInput, overrides: Partial<ProfileResult> = {}): ProfileResult {
  const validTime = new Date(String(query.validTime));
  const forecastHour = (validTime.getTime() - Date.parse(run)) / 3_600_000;
  return {
    model: "gfs_0p25",
    run,
    validTime: validTime.toISOString(),
    forecastHour,
    requestedPoint: { latitude: Number(query.latitude), longitude: Number(query.longitude) },
    gridPoint,
    levels: [{ pressureHpa: 850, temperatureC: forecastHour }],
    source: {
      provider: query.source === "nomads" ? "NOAA NOMADS" : "NOAA AWS Open Data",
      access: query.source === "nomads" ? "nomads_grib_filter" : "s3_range",
      decoder: "wgrib2",
      cacheHit: forecastHour % 2 === 0,
    },
    ...overrides,
  };
}

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run,
  startTime: "2026-08-23T22:00:00Z",
  endTime: "2026-08-24T06:00:00Z",
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
};

describe("TimeSeriesService", () => {
  it("uses native cadence across the f120 transition and returns compact ordered steps", async () => {
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query));
    const service = new TimeSeriesService({ profileGetter: { getProfile }, concurrency: 3 });
    const result = await service.getTimeSeries(base);

    expect(result.series.map((step) => step.forecastHour)).toEqual([118, 119, 120, 123, 126]);
    expect(result.series.map((step) => step.validTime)).toEqual([
      "2026-08-23T22:00:00.000Z",
      "2026-08-23T23:00:00.000Z",
      "2026-08-24T00:00:00.000Z",
      "2026-08-24T03:00:00.000Z",
      "2026-08-24T06:00:00.000Z",
    ]);
    expect(result.source).toEqual({
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
    });
    expect(result.series[0]?.levels[0]?.temperatureC).toBe(118);
    expect(result.series[0]?.cacheHit).toBe(true);
    expect(result.series[1]?.cacheHit).toBe(false);
    expect(getProfile.mock.calls.every(([query]) => query.source === "s3")).toBe(true);
  });

  it("defaults to bounded concurrency of four", () => {
    expect(DEFAULT_TIME_SERIES_CONCURRENCY).toBe(4);
  });

  it("bounds concurrent profile operations", async () => {
    let active = 0;
    let maxActive = 0;
    const getProfile = vi.fn(async (query: ProfileQueryInput) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return profileFor(query);
    });
    const service = new TimeSeriesService({ profileGetter: { getProfile }, concurrency: 2 });
    await service.getTimeSeries({
      ...base,
      startTime: "2026-08-19T00:00:00Z",
      endTime: "2026-08-19T05:00:00Z",
    });
    expect(maxActive).toBe(2);
  });

  it("resolves query-aware latest exactly once and passes the explicit resolved run to every profile", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(run));
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query));
    const service = new TimeSeriesService({
      profileGetter: { getProfile },
      latestRunProvider: { resolveLatestRun },
    });
    await service.getTimeSeries({ ...base, run: "latest" });
    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(resolveLatestRun).toHaveBeenCalledWith({
      type: "time_range",
      startTime: new Date(base.startTime),
      endTime: new Date(base.endTime),
      selection: {
        variableCodes: ["TMP"],
        pressureLevelsHpa: [850],
        fields: [],
      },
    });
    expect(getProfile.mock.calls.every(([query]) => query.run === run)).toBe(true);
  });

  it("uses complete-run discovery when latest_complete is requested", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(run));
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query));
    const service = new TimeSeriesService({ profileGetter: { getProfile }, latestRunProvider: { resolveLatestRun } });
    await service.getTimeSeries({ ...base, run: "latest_complete" });
    expect(resolveLatestRun).toHaveBeenCalledWith();
  });

  it("does not call latest-run discovery for an explicit run", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(run));
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query));
    const service = new TimeSeriesService({
      profileGetter: { getProfile },
      latestRunProvider: { resolveLatestRun },
    });
    await service.getTimeSeries(base);
    expect(resolveLatestRun).not.toHaveBeenCalled();
  });

  it("fails before data access when the native-step count exceeds maxSteps", async () => {
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query));
    const service = new TimeSeriesService({ profileGetter: { getProfile } });
    await expect(
      service.getTimeSeries({
        ...base,
        startTime: "2026-08-19T00:00:00Z",
        endTime: "2026-08-19T10:00:00Z",
        maxSteps: 5,
      }),
    ).rejects.toThrow(/11 native GFS outputs.*maxSteps=5/);
    expect(getProfile).not.toHaveBeenCalled();
  });

  it("supports NOMADS explicitly and reports NOMADS provenance", async () => {
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query));
    const service = new TimeSeriesService({ profileGetter: { getProfile } });
    const result = await service.getTimeSeries({ ...base, source: "nomads" });
    expect(result.source).toEqual({
      provider: "NOAA NOMADS",
      access: "nomads_grib_filter",
      decoder: "wgrib2",
    });
  });

  it("reports native-step progress without changing result ordering", async () => {
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query));
    const onProgress = vi.fn();
    const service = new TimeSeriesService({
      profileGetter: { getProfile },
      concurrency: 1,
      onProgress,
    });

    await service.getTimeSeries({
      ...base,
      startTime: "2026-08-19T00:00:00Z",
      endTime: "2026-08-19T02:00:00Z",
      source: "nomads",
    });

    expect(onProgress.mock.calls[0]?.[0]).toMatchObject({
      phase: "start",
      completedSteps: 0,
      totalSteps: 3,
      source: "nomads",
    });
    expect(onProgress.mock.calls.slice(1, 4).map(([progress]) => ({
      phase: progress.phase,
      completedSteps: progress.completedSteps,
      forecastHour: progress.forecastHour,
      cacheHit: progress.cacheHit,
    }))).toEqual([
      { phase: "step", completedSteps: 1, forecastHour: 0, cacheHit: true },
      { phase: "step", completedSteps: 2, forecastHour: 1, cacheHit: false },
      { phase: "step", completedSteps: 3, forecastHour: 2, cacheHit: true },
    ]);
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({
      phase: "complete",
      completedSteps: 3,
      totalSteps: 3,
      source: "nomads",
    });
  });

  it("normalizes offset range timestamps in the result", async () => {
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query));
    const service = new TimeSeriesService({ profileGetter: { getProfile } });
    const result = await service.getTimeSeries({
      ...base,
      startTime: "2026-08-24T00:00:00+02:00",
      endTime: "2026-08-24T02:00:00+02:00",
    });
    expect(result.requestedStartTime).toBe("2026-08-23T22:00:00.000Z");
    expect(result.requestedEndTime).toBe("2026-08-24T00:00:00.000Z");
  });

  it("rejects a changing grid point within one series", async () => {
    let call = 0;
    const getProfile = vi.fn(async (query: ProfileQueryInput) => {
      call += 1;
      return profileFor(query, call === 2 ? { gridPoint: { latitude: 49.75, longitude: 14.5 } } : {});
    });
    const service = new TimeSeriesService({ profileGetter: { getProfile } });
    await expect(service.getTimeSeries({ ...base, endTime: "2026-08-23T23:00:00Z" })).rejects.toThrow(/grid point changed/);
  });

  it("rejects a changing source within one series", async () => {
    let call = 0;
    const getProfile = vi.fn(async (query: ProfileQueryInput) => {
      call += 1;
      return profileFor(query, call === 2 ? {
        source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false },
      } : {});
    });
    const service = new TimeSeriesService({ profileGetter: { getProfile } });
    await expect(service.getTimeSeries({ ...base, endTime: "2026-08-23T23:00:00Z" })).rejects.toThrow(/Data source changed/);
  });

  it("propagates profile failures", async () => {
    const service = new TimeSeriesService({
      profileGetter: { getProfile: async () => { throw new Error("range download failed"); } },
    });
    await expect(service.getTimeSeries(base)).rejects.toThrow("range download failed");
  });
});
