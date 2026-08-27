import { describe, expect, it, vi } from "vitest";
import {
  IfsPointsService,
  IfsPointsTimeSeriesService,
  IfsTimeSeriesService,
  IfsTransectService,
} from "../src/core/ifs-spatiotemporal.js";
import type { IfsPointQueryInput, IfsProfileResult } from "../src/schema/ifs.js";

const run = new Date("2026-08-27T12:00:00Z");

function profileFor(input: IfsPointQueryInput, cacheHit = true): IfsProfileResult {
  const validTime = new Date(String(input.validTime));
  const runTime = new Date(String(input.run));
  const forecastHour = (validTime.getTime() - runTime.getTime()) / 3_600_000;
  return {
    model: "ifs_0p25",
    run: runTime.toISOString(),
    validTime: validTime.toISOString(),
    forecastHour,
    requestedPoint: { latitude: Number(input.latitude), longitude: Number(input.longitude) },
    gridPoint: { latitude: Number(input.latitude), longitude: Number(input.longitude) },
    levels: [{ pressureHpa: 850, temperatureC: 10 + forecastHour / 10 }],
    source: {
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      product: "ifs_0p25_oper_fc",
      horizontalGridDegrees: 0.25,
      cacheHit,
    },
  };
}

describe("IFS composed spatiotemporal operations", () => {
  it("pins one latest run across a native point time series", async () => {
    const getProfile = vi.fn(async (input: IfsPointQueryInput) => profileFor(input));
    const resolveLatestRunForRange = vi.fn(async () => run);
    const service = new IfsTimeSeriesService({
      profileGetter: { getProfile },
      latestRangeRunProvider: { resolveLatestRunForRange },
      timeConcurrency: 2,
    });

    const result = await service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      startTime: "2026-08-27T12:00:00Z",
      endTime: "2026-08-27T21:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });

    expect(resolveLatestRunForRange).toHaveBeenCalledOnce();
    expect(result.run).toBe(run.toISOString());
    expect(result.series.map((step) => step.forecastHour)).toEqual([0, 3, 6, 9]);
    expect(getProfile.mock.calls.every(([input]) => input.run === run.toISOString())).toBe(true);
  });

  it("uses an explicit run without invoking latest-run discovery", async () => {
    const getProfile = vi.fn(async (input: IfsPointQueryInput) => profileFor(input));
    const resolveLatestRunForRange = vi.fn(async () => run);
    const timeSeries = new IfsTimeSeriesService({
      profileGetter: { getProfile },
      latestRangeRunProvider: { resolveLatestRunForRange },
    });

    const result = await timeSeries.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: "2026-08-27T12:00:00Z",
      endTime: "2026-08-27T15:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxSteps: 2,
    });

    expect(result.series.map((step) => step.forecastHour)).toEqual([0, 3]);
    expect(resolveLatestRunForRange).not.toHaveBeenCalled();

    const resolveLatestRun = vi.fn(async () => run);
    const points = new IfsPointsService({
      profileGetter: { getProfile },
      latestRunProvider: { resolveLatestRun },
    });
    const pointResult = await points.getPoints({
      points: [{ latitude: 50.08, longitude: 14.43 }],
      run: run.toISOString(),
      validTime: "2026-08-27T15:00:00Z",
      fields: ["temperature_2m"],
    });
    expect(pointResult.forecastHour).toBe(3);
    expect(resolveLatestRun).not.toHaveBeenCalled();
  });

  it("rejects source-provenance drift inside one composed IFS query", async () => {
    const getProfile = vi.fn(async (input: IfsPointQueryInput) => {
      const profile = profileFor(input);
      if (profile.forecastHour === 3) {
        profile.source.decoder = "wgrib2";
      }
      return profile;
    });
    const service = new IfsTimeSeriesService({ profileGetter: { getProfile } });

    await expect(service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: "2026-08-27T12:00:00Z",
      endTime: "2026-08-27T15:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).rejects.toThrow("source provenance changed");
  });

  it("resolves one run for many points and preserves per-point samples", async () => {
    let calls = 0;
    const getProfile = vi.fn(async (input: IfsPointQueryInput) => {
      calls += 1;
      return profileFor(input, calls > 1);
    });
    const resolveLatestRun = vi.fn(async () => run);
    const service = new IfsPointsService({
      profileGetter: { getProfile },
      latestRunProvider: { resolveLatestRun },
      pointConcurrency: 2,
    });

    const result = await service.getPoints({
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.2, longitude: 16.61 },
      ],
      run: "latest",
      validTime: "2026-08-27T18:00:00Z",
      fields: ["temperature_2m"],
    });

    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(result.points.map((sample) => sample.requestedPoint)).toEqual([
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 49.2, longitude: 16.61 },
    ]);
    expect(result.source.allCacheHit).toBe(false);
    expect(getProfile.mock.calls.every(([input]) => input.run === run.toISOString())).toBe(true);
  });

  it("enforces point-timeseries guardrails before dispatching the matrix", async () => {
    const getPoints = vi.fn();
    const service = new IfsPointsTimeSeriesService({
      profileGetter: { getProfile: vi.fn(async (input: IfsPointQueryInput) => profileFor(input)) },
      latestRangeRunProvider: { resolveLatestRunForRange: vi.fn(async () => run) },
    });
    (service as any).pointsService = { getPoints };

    await expect(service.getPointsTimeSeries({
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.2, longitude: 16.61 },
      ],
      run: "latest",
      startTime: "2026-08-27T12:00:00Z",
      endTime: "2026-08-27T21:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxPointSteps: 7,
    })).rejects.toThrow("8 point × time samples");

    expect(getPoints).not.toHaveBeenCalled();
  });

  it("uses shared great-circle geometry for IFS transects", async () => {
    const getProfile = vi.fn(async (input: IfsPointQueryInput) => profileFor(input));
    const service = new IfsTransectService({
      profileGetter: { getProfile },
      latestRunProvider: { resolveLatestRun: vi.fn(async () => run) },
    });

    const result = await service.getTransect({
      start: { latitude: 50, longitude: 14 },
      end: { latitude: 50.5, longitude: 15 },
      run: "latest",
      validTime: "2026-08-27T18:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      samples: 3,
    });

    expect(result.samples).toHaveLength(3);
    expect(result.samples[0]?.fraction).toBe(0);
    expect(result.samples[2]?.fraction).toBe(1);
    expect(result.samples[0]?.requestedPoint).toEqual({ latitude: 50, longitude: 14 });
    expect(result.samples[2]?.requestedPoint).toEqual({ latitude: 50.5, longitude: 15 });
    expect(result.totalDistanceKm).toBeGreaterThan(0);
  });
});
