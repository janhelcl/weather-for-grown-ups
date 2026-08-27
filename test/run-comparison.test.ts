import { describe, expect, it, vi } from "vitest";
import {
  circularDegreeDelta,
  DEFAULT_RUN_COMPARISON_CONCURRENCY,
  RunComparisonService,
} from "../src/core/run-comparison.js";
import type { ProfileResult } from "../src/core/types.js";
import type { ProfileQueryInput } from "../src/schema/query.js";

const validTime = "2026-08-20T12:00:00.000Z";
const anchorRun = "2026-08-19T12:00:00.000Z";
const gridPoint = { latitude: 50, longitude: 14.5 };

function profileFor(
  query: ProfileQueryInput,
  temperatureC: number,
  directionDeg: number,
  precipitationWindow?: { startTime: string; endTime: string },
): ProfileResult {
  const run = new Date(String(query.run));
  const valid = new Date(String(query.validTime));
  const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
  return {
    model: query.grid === "0p50" ? "gfs_0p50" : "gfs_0p25",
    run: run.toISOString(),
    validTime: valid.toISOString(),
    forecastHour,
    requestedPoint: { latitude: Number(query.latitude), longitude: Number(query.longitude) },
    gridPoint,
    levels: [{
      pressureHpa: 850,
      temperatureC,
      windSpeedMs: 10 + temperatureC,
      windDirectionDeg: directionDeg,
    }],
    fields: [
      {
        id: "temperature_2m",
        level: { type: "height_above_ground_m", heightM: 2 },
        temporal: { type: "instantaneous" },
        values: { temperatureC: temperatureC + 1 },
      },
      {
        id: "total_precipitation",
        level: { type: "surface" },
        temporal: precipitationWindow
          ? {
              type: "accumulation",
              startForecastHour: 0,
              endForecastHour: forecastHour,
              startTime: precipitationWindow.startTime,
              endTime: precipitationWindow.endTime,
            }
          : { type: "instantaneous" },
        values: { precipitationMm: temperatureC },
      },
    ],
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      cacheHit: temperatureC % 2 === 0,
    },
  };
}

const baseQuery = {
  latitude: 50.08,
  longitude: 14.43,
  anchorRun,
  validTime,
  variables: ["temperature", "wind"] as const,
  pressureLevelsHpa: [850],
  fields: ["temperature_2m", "total_precipitation"] as const,
  cycles: 3,
};

describe("RunComparisonService", () => {
  it("compares consecutive cycles oldest to newest with newer-minus-older deltas", async () => {
    const values = new Map([
      ["2026-08-19T00:00:00.000Z", { temperature: 1, direction: 350 }],
      ["2026-08-19T06:00:00.000Z", { temperature: 3, direction: 10 }],
      ["2026-08-19T12:00:00.000Z", { temperature: 2, direction: 355 }],
    ]);
    const getProfile = vi.fn(async (query: ProfileQueryInput) => {
      const value = values.get(String(query.run));
      if (!value) throw new Error(`unexpected run ${query.run}`);
      return profileFor(query, value.temperature, value.direction);
    });
    const service = new RunComparisonService({ profileGetter: { getProfile }, concurrency: 2 });
    const result = await service.compareRuns(baseQuery);

    expect(result.runs.map((run) => run.run)).toEqual([
      "2026-08-19T00:00:00.000Z",
      "2026-08-19T06:00:00.000Z",
      "2026-08-19T12:00:00.000Z",
    ]);
    expect(result.runs.map((run) => run.forecastHour)).toEqual([36, 30, 24]);
    expect(result.comparisons).toHaveLength(2);

    const firstChanges = result.comparisons[0]!.pressureLevels[0]!.changes;
    expect(firstChanges.find((change) => change.field === "temperatureC")).toMatchObject({
      from: 1,
      to: 3,
      delta: 2,
      deltaKind: "linear",
    });
    expect(firstChanges.find((change) => change.field === "windDirectionDeg")).toMatchObject({
      from: 350,
      to: 10,
      delta: 20,
      deltaKind: "circular_degrees",
    });

    const secondDirection = result.comparisons[1]!.pressureLevels[0]!.changes
      .find((change) => change.field === "windDirectionDeg");
    expect(secondDirection?.delta).toBe(-15);
    expect(getProfile.mock.calls.every(([query]) => query.source === "s3")).toBe(true);
  });

  it("compares consecutive cycles on the explicit 0.5 grid", async () => {
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query, 5, 180));
    const service = new RunComparisonService({ profileGetter: { getProfile } });
    const result = await service.compareRuns({ ...baseQuery, grid: "0p50" });

    expect(result.model).toBe("gfs_0p50");
    expect(getProfile).toHaveBeenCalledTimes(3);
    expect(getProfile.mock.calls.every(([query]) => query.grid === "0p50")).toBe(true);
  });

  it("marks interval fields non-comparable when their absolute windows differ", async () => {
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(
      query,
      new Date(String(query.run)).getUTCHours(),
      180,
      { startTime: String(query.run), endTime: validTime },
    ));
    const service = new RunComparisonService({ profileGetter: { getProfile } });
    const result = await service.compareRuns(baseQuery);
    const precipitation = result.comparisons[0]!.fields.find((field) => field.id === "total_precipitation");
    expect(precipitation).toEqual({
      id: "total_precipitation",
      comparable: false,
      reason: "temporal_windows_differ",
      changes: [],
    });
    const temperature2m = result.comparisons[0]!.fields.find((field) => field.id === "temperature_2m");
    expect(temperature2m?.comparable).toBe(true);
    expect(temperature2m?.changes[0]?.delta).toBe(6);
  });

  it("resolves latest once for the exact atmospheric selection and then uses explicit cycles", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(anchorRun));
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query, 5, 180));
    const service = new RunComparisonService({
      latestRunProvider: { resolveLatestRun },
      profileGetter: { getProfile },
    });
    await service.compareRuns({ ...baseQuery, anchorRun: "latest" });

    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(resolveLatestRun).toHaveBeenCalledWith(expect.objectContaining({
      type: "valid_time",
      validTime: new Date(validTime),
      selection: expect.objectContaining({ pressureLevelsHpa: [850] }),
    }));
    expect(getProfile.mock.calls.map(([query]) => query.run)).toEqual([
      "2026-08-19T00:00:00.000Z",
      "2026-08-19T06:00:00.000Z",
      "2026-08-19T12:00:00.000Z",
    ]);
  });

  it("uses grid-aware latest discovery for 0.5 run comparison", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(anchorRun));
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query, 5, 180));
    const service = new RunComparisonService({
      latestRunProvider: { resolveLatestRun },
      profileGetter: { getProfile },
    });
    await service.compareRuns({ ...baseQuery, anchorRun: "latest", grid: "0p50" });
    expect(resolveLatestRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: "valid_time" }),
      "0p50",
    );
  });

  it("uses complete-run discovery for latest_complete", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(anchorRun));
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query, 5, 180));
    const service = new RunComparisonService({ latestRunProvider: { resolveLatestRun }, profileGetter: { getProfile } });
    await service.compareRuns({ ...baseQuery, anchorRun: "latest_complete", cycles: 2 });
    expect(resolveLatestRun).toHaveBeenCalledWith();
  });

  it("uses grid-aware complete-run discovery for 0.5 run comparison", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(anchorRun));
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query, 5, 180));
    const service = new RunComparisonService({
      latestRunProvider: { resolveLatestRun },
      profileGetter: { getProfile },
    });
    await service.compareRuns({
      ...baseQuery,
      anchorRun: "latest_complete",
      grid: "0p50",
      cycles: 2,
    });
    expect(resolveLatestRun).toHaveBeenCalledWith(undefined, "0p50");
  });

  it("does not discover a run when anchorRun is explicit", async () => {
    const resolveLatestRun = vi.fn(async () => new Date(anchorRun));
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query, 5, 180));
    const service = new RunComparisonService({ latestRunProvider: { resolveLatestRun }, profileGetter: { getProfile } });
    await service.compareRuns(baseQuery);
    expect(resolveLatestRun).not.toHaveBeenCalled();
  });

  it("bounds concurrent cycle fetches", async () => {
    let active = 0;
    let maxActive = 0;
    const getProfile = vi.fn(async (query: ProfileQueryInput) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return profileFor(query, 5, 180);
    });
    const service = new RunComparisonService({ profileGetter: { getProfile }, concurrency: 2 });
    await service.compareRuns({ ...baseQuery, cycles: 6 });
    expect(maxActive).toBe(2);
  });

  it("defaults to four concurrent run fetches", () => {
    expect(DEFAULT_RUN_COMPARISON_CONCURRENCY).toBe(4);
  });

  it("wraps a cycle failure with the run and valid time", async () => {
    const service = new RunComparisonService({
      profileGetter: { getProfile: async () => { throw new Error("forecast file unavailable"); } },
    });
    await expect(service.compareRuns({ ...baseQuery, cycles: 2 })).rejects.toThrow(
      /Cannot compare GFS run .* at 2026-08-20T12:00:00.000Z: forecast file unavailable/,
    );
  });
});

describe("circularDegreeDelta", () => {
  it("returns the shortest signed angular change", () => {
    expect(circularDegreeDelta(350, 10)).toBe(20);
    expect(circularDegreeDelta(10, 350)).toBe(-20);
    expect(circularDegreeDelta(90, 270)).toBe(-180);
  });
});
