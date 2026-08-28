import { describe, expect, it, vi } from "vitest";
import {
  IfsEnsPointsService,
  IfsEnsPointsTimeSeriesService,
} from "../src/core/ifs-ens-points.js";
import type { IfsEnsMemberBundleResult } from "../src/schema/ifs-ens.js";
import type { IfsEnsPointsResult } from "../src/schema/ifs-ens-points.js";

const run = new Date("2026-08-27T12:00:00Z");
const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.82, longitude: 14.21 },
] as const;
const members = ["p01", "p50"] as const;
const quantiles = [0.5];

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

function bundleResult(
  requestedPoint: { latitude: number; longitude: number },
  validTime: string,
  forecastHour: number,
  pointIndex: number,
  includeMembers = false,
): IfsEnsMemberBundleResult {
  const gridPoint = pointIndex === 0
    ? { latitude: 50, longitude: 14.5 }
    : { latitude: 49.75, longitude: 14.25 };
  return {
    model: "ifs_ens_0p25",
    run: run.toISOString(),
    validTime,
    forecastHour,
    requestedPoint,
    gridPoint,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: [],
      members: [...members],
      quantiles,
    },
    pressureSummaries: [{
      variable: "temperature",
      pressureLevelHpa: 850,
      outputs: [{
        aggregation: "numeric_distribution",
        field: "temperatureC",
        unit: "degC",
        distribution: distribution(10 + pointIndex + forecastHour / 100),
      }],
    }],
    fieldSummaries: [],
    ...(includeMembers
      ? {
          members: members.map((member, index) => ({
            member,
            cacheHit: index === 1,
            pressureValues: [{
              variable: "temperature" as const,
              pressureLevelHpa: 850 as const,
              values: { temperatureC: 9 + pointIndex + index },
            }],
            fields: [],
          })),
        }
      : {}),
    source: {
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      product: "ifs_0p25_enfo_ef",
      horizontalGridDegrees: 0.25,
      allCacheHit: pointIndex === 1,
      memberSemantics: "50_perturbed_members_control_is_oper_fc",
    },
  };
}

function pointsResult(
  validTime: string,
  forecastHour: number,
  drift = false,
  includeMembers = false,
): IfsEnsPointsResult {
  const bundles = points.map((point, pointIndex) =>
    bundleResult(point, validTime, forecastHour, pointIndex, includeMembers));
  if (drift) {
    bundles[0] = {
      ...bundles[0]!,
      gridPoint: { latitude: 50.25, longitude: 14.5 },
    };
  }
  return {
    model: "ifs_ens_0p25",
    run: run.toISOString(),
    validTime,
    forecastHour,
    selection: bundles[0]!.selection,
    includeMembers,
    points: bundles.map((bundle) => ({
      requestedPoint: bundle.requestedPoint,
      gridPoint: bundle.gridPoint,
      pressureSummaries: bundle.pressureSummaries,
      fieldSummaries: bundle.fieldSummaries,
      ...(bundle.members === undefined ? {} : { members: bundle.members }),
      allCacheHit: bundle.source.allCacheHit,
    })),
    source: {
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      product: "ifs_0p25_enfo_ef",
      horizontalGridDegrees: 0.25,
      allCacheHit: false,
      memberSemantics: "50_perturbed_members_control_is_oper_fc",
    },
  };
}

describe("IFS ENS multi-point state", () => {
  it("resolves latest once and preserves requested point ordering", async () => {
    const resolveLatestRun = vi.fn(async () => run);
    const getBundle = vi.fn(async (query: {
      latitude: number;
      longitude: number;
      run: string;
      validTime: string;
      includeMembers?: boolean;
    }) => {
      const index = points.findIndex((point) =>
        point.latitude === query.latitude && point.longitude === query.longitude);
      return bundleResult(
        { latitude: query.latitude, longitude: query.longitude },
        new Date(query.validTime).toISOString(),
        6,
        index,
        query.includeMembers === true,
      );
    });
    const service = new IfsEnsPointsService({
      latestRunProvider: { resolveLatestRun },
      bundleGetter: { getBundle },
      pointConcurrency: 2,
    });
    const validTime = new Date(run.getTime() + 6 * 3_600_000);

    const result = await service.getPoints({
      points: [...points],
      run: "latest",
      validTime: validTime.toISOString(),
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      members: [...members],
      quantiles,
    });

    expect(resolveLatestRun).toHaveBeenCalledOnce();
    const selectors = resolveLatestRun.mock.calls[0]?.[1] as Array<{ number?: number }>;
    expect(new Set(selectors.map((selector) => selector.number))).toEqual(new Set([1, 50]));
    expect(getBundle).toHaveBeenCalledTimes(2);
    expect(getBundle.mock.calls.every(([query]) => query.run === run.toISOString())).toBe(true);
    expect(result.points.map((point) => point.requestedPoint)).toEqual(points);
    expect(result.points.map((point) => point.gridPoint)).toEqual([
      { latitude: 50, longitude: 14.5 },
      { latitude: 49.75, longitude: 14.25 },
    ]);
    expect(result.forecastHour).toBe(6);
  });

  it("guards raw member payload size before dispatching point bundles", async () => {
    const getBundle = vi.fn();
    const service = new IfsEnsPointsService({ bundleGetter: { getBundle } });

    await expect(service.getPoints({
      points: [...points],
      run: run.toISOString(),
      validTime: run.toISOString(),
      selection: {
        variables: ["wind"],
        pressureLevelsHpa: [850],
        fields: ["wind_10m"],
      },
      members: ["p01", "p02"],
      includeMembers: true,
      maxMemberSamples: 15,
    })).rejects.toThrow("16 member scalar samples");

    expect(getBundle).not.toHaveBeenCalled();
  });

  it("returns member payloads when requested within the guardrail", async () => {
    const getBundle = vi.fn(async (query: {
      latitude: number;
      longitude: number;
      validTime: string;
      includeMembers?: boolean;
    }) => {
      const index = points.findIndex((point) =>
        point.latitude === query.latitude && point.longitude === query.longitude);
      return bundleResult(
        { latitude: query.latitude, longitude: query.longitude },
        query.validTime,
        0,
        index,
        query.includeMembers === true,
      );
    });
    const service = new IfsEnsPointsService({ bundleGetter: { getBundle } });

    const result = await service.getPoints({
      points: [...points],
      run: run.toISOString(),
      validTime: run.toISOString(),
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      members: [...members],
      quantiles,
      includeMembers: true,
      maxMemberSamples: 10,
    });

    expect(result.includeMembers).toBe(true);
    expect(result.points.every((point) => point.members?.length === 2)).toBe(true);
  });
});

describe("IFS ENS multi-point time series", () => {
  it("preserves the native f144 cadence transition across every point", async () => {
    const getPoints = vi.fn(async (query: { run: string; validTime: string; includeMembers?: boolean }) => {
      const valid = new Date(query.validTime);
      const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
      return pointsResult(valid.toISOString(), forecastHour, false, query.includeMembers === true);
    });
    const service = new IfsEnsPointsTimeSeriesService({
      pointsGetter: { getPoints },
      stepConcurrency: 2,
    });

    const result = await service.getPointsTimeSeries({
      points: [...points],
      run: run.toISOString(),
      startTime: new Date(run.getTime() + 138 * 3_600_000).toISOString(),
      endTime: new Date(run.getTime() + 156 * 3_600_000).toISOString(),
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      members: [...members],
      quantiles,
      maxSteps: 5,
      maxPointSteps: 10,
    });

    expect(result.series.map((step) => step.forecastHour)).toEqual([138, 141, 144, 150, 156]);
    expect(result.series.every((step) => step.points.length === 2)).toBe(true);
    expect(getPoints).toHaveBeenCalledTimes(5);
    expect(getPoints.mock.calls.every(([query]) => query.run === run.toISOString())).toBe(true);
    expect(result.cadence).toBe("ecmwf_ens_native_3h_through_f144_then_6h_on_00_12z");
  });

  it("pins one latest run across the complete point × time matrix", async () => {
    const resolveLatestRunForRange = vi.fn(async () => run);
    const getPoints = vi.fn(async (query: { validTime: string }) => {
      const valid = new Date(query.validTime);
      const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
      return pointsResult(valid.toISOString(), forecastHour);
    });
    const service = new IfsEnsPointsTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunForRange },
      pointsGetter: { getPoints },
    });

    const result = await service.getPointsTimeSeries({
      points: [...points],
      run: "latest",
      startTime: new Date(run.getTime() + 3 * 3_600_000).toISOString(),
      endTime: new Date(run.getTime() + 9 * 3_600_000).toISOString(),
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      members: [...members],
      quantiles,
    });

    expect(resolveLatestRunForRange).toHaveBeenCalledOnce();
    const selectors = resolveLatestRunForRange.mock.calls[0]?.[2] as Array<{ number?: number }>;
    expect(new Set(selectors.map((selector) => selector.number))).toEqual(new Set([1, 50]));
    expect(result.series.map((step) => step.forecastHour)).toEqual([3, 6, 9]);
  });

  it("guards both point-step and raw member payload matrices before dispatch", async () => {
    const getPoints = vi.fn();
    const service = new IfsEnsPointsTimeSeriesService({ pointsGetter: { getPoints } });
    const common = {
      points: [...points],
      run: run.toISOString(),
      startTime: new Date(run.getTime() + 138 * 3_600_000).toISOString(),
      endTime: new Date(run.getTime() + 156 * 3_600_000).toISOString(),
      selection: {
        variables: ["temperature"] as ["temperature"],
        pressureLevelsHpa: [850] as [850],
      },
      members: [...members],
      quantiles,
      maxSteps: 5,
    };

    await expect(service.getPointsTimeSeries({
      ...common,
      maxPointSteps: 9,
    })).rejects.toThrow("10 point-steps");

    await expect(service.getPointsTimeSeries({
      ...common,
      maxPointSteps: 10,
      includeMembers: true,
      maxMemberSamples: 19,
    })).rejects.toThrow("20 member scalar samples");

    expect(getPoints).not.toHaveBeenCalled();
  });

  it("rejects grid drift for the same requested point across forecast steps", async () => {
    let call = 0;
    const service = new IfsEnsPointsTimeSeriesService({
      pointsGetter: {
        getPoints: async (query) => {
          call += 1;
          const valid = new Date(query.validTime);
          const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
          return pointsResult(valid.toISOString(), forecastHour, call === 2);
        },
      },
      stepConcurrency: 1,
    });

    await expect(service.getPointsTimeSeries({
      points: [...points],
      run: run.toISOString(),
      startTime: run.toISOString(),
      endTime: new Date(run.getTime() + 3 * 3_600_000).toISOString(),
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      members: [...members],
      quantiles,
    })).rejects.toThrow("grid point changed across forecast steps");
  });
});
