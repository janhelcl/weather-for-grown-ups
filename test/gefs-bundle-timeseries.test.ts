import { describe, expect, it, vi } from "vitest";
import { GefsBundleTimeSeriesService } from "../src/core/gefs-bundle-timeseries.js";
import type { GefsMemberBundleResult } from "../src/schema/gefs-member-bundle.js";

const run = new Date("2026-08-24T00:00:00Z");
const start = new Date("2026-08-24T03:00:00Z");
const end = new Date("2026-08-24T09:00:00Z");
const members = ["c00", "p01"] as const;
const quantiles = [0.5];
const gridPoint = { latitude: 50, longitude: 14.5 };

function distribution(mean: number) {
  return {
    memberCount: 2,
    mean,
    populationStdDev: 1,
    min: mean - 1,
    max: mean + 1,
    quantiles: [{ quantile: 0.5, value: mean }],
  };
}

function bundleResult(validTime: string, forecastHour: number): GefsMemberBundleResult {
  return {
    model: "gefs_0p50",
    run: run.toISOString(),
    validTime,
    forecastHour,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["temperature_2m", "total_precipitation"],
      members: [...members],
      quantiles,
    },
    pressureSummaries: [{
      variable: "temperature",
      pressureLevelHpa: 850,
      outputField: "temperatureC",
      unit: "degC",
      distribution: distribution(10 + forecastHour),
    }],
    fieldSummaries: [
      {
        field: "temperature_2m",
        level: { gribLevel: "2 m above ground", description: "2 m above ground" },
        temporal: { type: "instantaneous" },
        outputs: [{
          aggregation: "numeric_distribution",
          field: "temperatureC",
          unit: "degC",
          distribution: distribution(15 + forecastHour),
        }],
      },
      {
        field: "total_precipitation",
        level: { gribLevel: "surface", description: "model surface" },
        temporal: {
          type: "accumulation",
          startForecastHour: Math.max(0, forecastHour - 3),
          endForecastHour: forecastHour,
          startTime: new Date(run.getTime() + Math.max(0, forecastHour - 3) * 3_600_000).toISOString(),
          endTime: validTime,
        },
        outputs: [{
          aggregation: "numeric_distribution",
          field: "totalPrecipitationMm",
          unit: "mm",
          distribution: distribution(forecastHour / 3),
        }],
      },
    ],
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      product: "pgrb2a_0p50",
      horizontalGridDegrees: 0.5,
      allCacheHit: forecastHour === 3,
    },
  };
}

describe("GEFS mixed bundle time series", () => {
  it("resolves one run for the range and reuses the single-time bundle service at native steps", async () => {
    const resolveLatestRunRange = vi.fn(async () => run);
    const getBundle = vi.fn(async (query: { validTime: string }) => {
      const valid = new Date(query.validTime);
      const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
      return bundleResult(valid.toISOString(), forecastHour);
    });
    const service = new GefsBundleTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange },
      bundleGetter: { getBundle },
      stepConcurrency: 2,
    });

    const result = await service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m", "total_precipitation"],
      },
      members: [...members],
      quantiles,
      maxSteps: 3,
    });

    expect(resolveLatestRunRange).toHaveBeenCalledTimes(1);
    expect(resolveLatestRunRange).toHaveBeenCalledWith(start, end, [...members]);
    expect(getBundle).toHaveBeenCalledTimes(3);
    expect(getBundle.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
      expect.objectContaining({ run: run.toISOString(), validTime: start.toISOString(), includeMembers: false }),
      expect.objectContaining({ run: run.toISOString(), validTime: "2026-08-24T06:00:00.000Z", includeMembers: false }),
      expect.objectContaining({ run: run.toISOString(), validTime: end.toISOString(), includeMembers: false }),
    ]));
    expect(result.series.map((step) => step.forecastHour)).toEqual([3, 6, 9]);
    expect(result.series[1]?.fieldSummaries.find((field) => field.field === "total_precipitation")?.temporal).toMatchObject({
      type: "accumulation",
      startForecastHour: 3,
      endForecastHour: 6,
    });
    expect(result.source.allCacheHit).toBe(false);
  });

  it("pins one 0.25 field product across a field-only range through f240", async () => {
    const getBundle = vi.fn(async (query: any, product?: "pgrb2a_0p50" | "pgrb2s_0p25") => {
      const valid = new Date(query.validTime);
      const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
      const base: any = bundleResult(valid.toISOString(), forecastHour);
      base.selection = {
        variables: [],
        pressureLevelsHpa: [],
        fields: ["temperature_2m"],
        members: [...members],
        quantiles,
      };
      base.pressureSummaries = [];
      base.fieldSummaries = base.fieldSummaries.filter((field: any) => field.field === "temperature_2m");
      base.source.product = product;
      base.source.horizontalGridDegrees = product === "pgrb2s_0p25" ? 0.25 : 0.5;
      return base;
    });
    const service = new GefsBundleTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: async () => run },
      bundleGetter: { getBundle },
    });

    const result = await service.getTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      selection: { fields: ["temperature_2m"] },
      members: [...members],
      quantiles,
    });

    expect(getBundle).toHaveBeenCalled();
    expect(getBundle.mock.calls.every((call) => call[1] === "pgrb2s_0p25")).toBe(true);
    expect(result.source).toMatchObject({
      product: "pgrb2s_0p25",
      horizontalGridDegrees: 0.25,
    });
  });

  it("pins field-only ranges crossing f240 to 0.5 for the whole range", async () => {
    const lateStart = new Date(run.getTime() + 237 * 3_600_000);
    const lateEnd = new Date(run.getTime() + 243 * 3_600_000);
    const getBundle = vi.fn(async (query: any, product?: "pgrb2a_0p50" | "pgrb2s_0p25") => {
      const valid = new Date(query.validTime);
      const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
      const base: any = bundleResult(valid.toISOString(), forecastHour);
      base.selection = {
        variables: [],
        pressureLevelsHpa: [],
        fields: ["temperature_2m"],
        members: [...members],
        quantiles,
      };
      base.pressureSummaries = [];
      base.fieldSummaries = base.fieldSummaries.filter((field: any) => field.field === "temperature_2m");
      base.source.product = product;
      base.source.horizontalGridDegrees = product === "pgrb2s_0p25" ? 0.25 : 0.5;
      return base;
    });
    const service = new GefsBundleTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: async () => run },
      bundleGetter: { getBundle },
    });

    const result = await service.getTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: lateStart.toISOString(),
      endTime: lateEnd.toISOString(),
      selection: { fields: ["temperature_2m"] },
      members: [...members],
      quantiles,
    });

    expect(getBundle.mock.calls.every((call) => call[1] === "pgrb2a_0p50")).toBe(true);
    expect(result.source).toMatchObject({
      product: "pgrb2a_0p50",
      horizontalGridDegrees: 0.5,
    });
  });

  it("enforces includeMembers response-size guardrails before run resolution or bundle calls", async () => {
    const resolveLatestRunRange = vi.fn(async () => run);
    const getBundle = vi.fn(async () => bundleResult(start.toISOString(), 3));
    const service = new GefsBundleTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange },
      bundleGetter: { getBundle },
    });

    await expect(service.getTimeSeries({
      latitude: 50,
      longitude: 14,
      run: "latest",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m", "wind_10m"],
      },
      members: [...members],
      quantiles,
      includeMembers: true,
      maxSteps: 3,
      maxMemberSamples: 20,
    })).rejects.toThrow("exceeding maxMemberSamples=20");

    expect(resolveLatestRunRange).not.toHaveBeenCalled();
    expect(getBundle).not.toHaveBeenCalled();
  });

  it("rejects grid drift across forecast steps", async () => {
    let call = 0;
    const service = new GefsBundleTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunRange: async () => run },
      bundleGetter: {
        getBundle: async (query) => {
          call += 1;
          const valid = new Date(query.validTime);
          const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
          const result = bundleResult(valid.toISOString(), forecastHour);
          return call === 2 ? { ...result, gridPoint: { latitude: 50.5, longitude: 14.5 } } : result;
        },
      },
      stepConcurrency: 1,
    });

    await expect(service.getTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: start.toISOString(),
      endTime: "2026-08-24T06:00:00Z",
      selection: { fields: ["temperature_2m"] },
      members: [...members],
      quantiles,
    })).rejects.toThrow("inconsistent grid points");
  });
});
