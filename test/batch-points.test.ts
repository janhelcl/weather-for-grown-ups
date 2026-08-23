import { describe, expect, it, vi } from "vitest";
import { BatchPointsService, DEFAULT_BATCH_POINT_CONCURRENCY } from "../src/core/batch-points.js";
import type { ProfileResult } from "../src/core/types.js";
import type { ProfileQueryInput } from "../src/schema/query.js";

const run = new Date("2026-08-19T06:00:00Z");
const validTime = "2026-08-19T12:00:00Z";
const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 45.8, longitude: 11.7 },
  { latitude: 46.24, longitude: 13.18 },
];

function profileFor(query: ProfileQueryInput): ProfileResult {
  const latitude = Number(query.latitude);
  const longitude = Number(query.longitude);
  return {
    model: "gfs_0p25",
    run: run.toISOString(),
    validTime: new Date(String(query.validTime)).toISOString(),
    forecastHour: 6,
    requestedPoint: { latitude, longitude },
    gridPoint: { latitude: Math.round(latitude * 4) / 4, longitude: Math.round(longitude * 4) / 4 },
    levels: [{ pressureHpa: 850, temperatureC: latitude }],
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      cacheHit: longitude < 14,
    },
  };
}

const base = {
  points,
  run: "latest" as const,
  validTime,
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
};

describe("BatchPointsService", () => {
  it("resolves the run once and samples every point through the shared S3 selection", async () => {
    const resolveLatestRun = vi.fn(async () => run);
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query));
    const service = new BatchPointsService({
      latestRunProvider: { resolveLatestRun },
      profileGetter: { getProfile },
    });

    const result = await service.getPoints(base);

    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(resolveLatestRun).toHaveBeenCalledWith({
      type: "valid_time",
      validTime: new Date(validTime),
      selection: { variableCodes: ["TMP"], pressureLevelsHpa: [850], fields: [] },
    });
    expect(getProfile).toHaveBeenCalledTimes(3);
    expect(getProfile.mock.calls.every(([query]) => query.run === run.toISOString())).toBe(true);
    expect(getProfile.mock.calls.every(([query]) => query.source === "s3")).toBe(true);
    expect(result.points.map((point) => point.requestedPoint)).toEqual(points);
    expect(result.points.map((point) => point.levels[0]?.temperatureC)).toEqual(points.map((point) => point.latitude));
    expect(result.source).toEqual({
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      cacheHit: false,
    });
  });

  it("uses complete-run discovery for latest_complete", async () => {
    const resolveLatestRun = vi.fn(async () => run);
    const service = new BatchPointsService({
      latestRunProvider: { resolveLatestRun },
      profileGetter: { getProfile: async (query) => profileFor(query) },
    });
    await service.getPoints({ ...base, run: "latest_complete" });
    expect(resolveLatestRun).toHaveBeenCalledWith();
  });

  it("does not discover a run when an explicit cycle is supplied", async () => {
    const resolveLatestRun = vi.fn(async () => run);
    const service = new BatchPointsService({
      latestRunProvider: { resolveLatestRun },
      profileGetter: { getProfile: async (query) => profileFor(query) },
    });
    await service.getPoints({ ...base, run: run.toISOString() });
    expect(resolveLatestRun).not.toHaveBeenCalled();
  });

  it("bounds point decoding concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const service = new BatchPointsService({
      latestRunProvider: { resolveLatestRun: async () => run },
      concurrency: 2,
      profileGetter: {
        getProfile: async (query) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return profileFor(query);
        },
      },
    });
    await service.getPoints(base);
    expect(maxActive).toBe(2);
  });

  it("uses a conservative default point concurrency", () => {
    expect(DEFAULT_BATCH_POINT_CONCURRENCY).toBe(8);
  });

  it("rejects more than 50 points before run discovery", async () => {
    const resolveLatestRun = vi.fn(async () => run);
    const getProfile = vi.fn(async (query: ProfileQueryInput) => profileFor(query));
    const service = new BatchPointsService({ latestRunProvider: { resolveLatestRun }, profileGetter: { getProfile } });
    await expect(service.getPoints({
      ...base,
      points: Array.from({ length: 51 }, (_, index) => ({ latitude: 50, longitude: index / 10 })),
    })).rejects.toThrow();
    expect(resolveLatestRun).not.toHaveBeenCalled();
    expect(getProfile).not.toHaveBeenCalled();
  });

  it("rejects a profile getter that changes away from the S3 source", async () => {
    const service = new BatchPointsService({
      latestRunProvider: { resolveLatestRun: async () => run },
      profileGetter: {
        getProfile: async (query) => ({
          ...profileFor(query),
          source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false },
        }),
      },
    });
    await expect(service.getPoints(base)).rejects.toThrow(/require the NOAA AWS S3 byte-range source/);
  });
});
