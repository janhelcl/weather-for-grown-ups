import { describe, expect, it, vi } from "vitest";
import { IfsEnsTimeSeriesService } from "../src/core/ifs-ens-timeseries.js";
import type { IfsEnsMemberBundleResult } from "../src/schema/ifs-ens.js";

const run = new Date("2026-08-27T12:00:00Z");
const members = ["p01", "p02"] as const;
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

function bundleResult(validTime: string, forecastHour: number, includeMembers = false): IfsEnsMemberBundleResult {
  return {
    model: "ifs_ens_0p25",
    run: run.toISOString(),
    validTime,
    forecastHour,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint,
    selection: {
      variables: ["wind"],
      pressureLevelsHpa: [850],
      fields: ["wind_10m"],
      members: [...members],
      quantiles,
    },
    pressureSummaries: [{
      variable: "wind",
      pressureLevelHpa: 850,
      outputs: [
        {
          aggregation: "numeric_distribution",
          field: "windSpeedMs",
          unit: "m/s",
          distribution: distribution(8 + forecastHour / 10),
        },
        {
          aggregation: "circular_direction",
          field: "windDirectionDeg",
          unit: "degree",
          memberCount: 2,
          meanDirectionDeg: 180,
          resultantLength: 0.9,
        },
      ],
    }],
    fieldSummaries: [{
      field: "wind_10m",
      level: { type: "height_above_ground_m", heightM: 10 },
      temporal: { type: "instantaneous" },
      outputs: [
        {
          aggregation: "numeric_distribution",
          field: "windSpeedMs",
          unit: "m/s",
          distribution: distribution(4 + forecastHour / 20),
        },
        {
          aggregation: "circular_direction",
          field: "windDirectionDeg",
          unit: "degree",
          memberCount: 2,
          meanDirectionDeg: 90,
          resultantLength: 0.8,
        },
      ],
    }],
    ...(includeMembers
      ? {
          members: members.map((member, index) => ({
            member,
            cacheHit: index === 0,
            pressureValues: [{
              variable: "wind" as const,
              pressureLevelHpa: 850 as const,
              values: { windSpeedMs: 7 + index, windDirectionDeg: 175 + index * 10 },
            }],
            fields: [{
              field: "wind_10m" as const,
              temporal: { type: "instantaneous" as const },
              values: { windSpeedMs: 3 + index, windDirectionDeg: 85 + index * 10 },
            }],
          })),
        }
      : {}),
    source: {
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      product: "ifs_0p25_enfo_ef",
      horizontalGridDegrees: 0.25,
      allCacheHit: forecastHour === 138,
      memberSemantics: "50_perturbed_members_control_is_oper_fc",
    },
  };
}

describe("IFS ENS point time series", () => {
  it("preserves the native 3h-to-6h cadence transition on long 00/12Z runs", async () => {
    const getBundle = vi.fn(async (query: { validTime: string; includeMembers?: boolean }) => {
      const valid = new Date(query.validTime);
      const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
      return bundleResult(valid.toISOString(), forecastHour, query.includeMembers === true);
    });
    const service = new IfsEnsTimeSeriesService({
      bundleGetter: { getBundle },
      stepConcurrency: 2,
    });

    const result = await service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: new Date(run.getTime() + 138 * 3_600_000).toISOString(),
      endTime: new Date(run.getTime() + 156 * 3_600_000).toISOString(),
      selection: {
        variables: ["wind"],
        pressureLevelsHpa: [850],
        fields: ["wind_10m"],
      },
      members: [...members],
      quantiles,
      maxSteps: 5,
    });

    expect(result.series.map((step) => step.forecastHour)).toEqual([138, 141, 144, 150, 156]);
    expect(getBundle).toHaveBeenCalledTimes(5);
    expect(getBundle.mock.calls.every(([query]) => query.run === run.toISOString())).toBe(true);
    expect(result.source.allCacheHit).toBe(false);
  });

  it("pins one latest ENS run across the complete requested range", async () => {
    const resolveLatestRunForRange = vi.fn(async () => run);
    const getBundle = vi.fn(async (query: { validTime: string }) => {
      const valid = new Date(query.validTime);
      const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
      return bundleResult(valid.toISOString(), forecastHour);
    });
    const service = new IfsEnsTimeSeriesService({
      latestRunRangeProvider: { resolveLatestRunForRange },
      bundleGetter: { getBundle },
    });
    const startTime = new Date(run.getTime() + 3 * 3_600_000);
    const endTime = new Date(run.getTime() + 9 * 3_600_000);

    const result = await service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      selection: {
        variables: ["wind"],
        pressureLevelsHpa: [850],
        fields: ["wind_10m"],
      },
      members: [...members],
      quantiles,
    });

    expect(resolveLatestRunForRange).toHaveBeenCalledOnce();
    expect(result.run).toBe(run.toISOString());
    expect(result.series.map((step) => step.forecastHour)).toEqual([3, 6, 9]);
    const selectors = resolveLatestRunForRange.mock.calls[0]?.[2] as Array<{ number?: number }>;
    expect(new Set(selectors.map((selector) => selector.number))).toEqual(new Set([1, 2]));
  });

  it("guards raw member payload size before dispatching step bundles", async () => {
    const getBundle = vi.fn();
    const service = new IfsEnsTimeSeriesService({ bundleGetter: { getBundle } });

    await expect(service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: new Date(run.getTime() + 138 * 3_600_000).toISOString(),
      endTime: new Date(run.getTime() + 156 * 3_600_000).toISOString(),
      selection: {
        variables: ["wind"],
        pressureLevelsHpa: [850],
        fields: ["wind_10m"],
      },
      members: [...members],
      quantiles,
      includeMembers: true,
      maxMemberSamples: 20,
    })).rejects.toThrow("40 member scalar samples");

    expect(getBundle).not.toHaveBeenCalled();
  });

  it("includes member payloads when requested within the guardrail", async () => {
    const getBundle = vi.fn(async (query: { validTime: string; includeMembers?: boolean }) => {
      const valid = new Date(query.validTime);
      const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
      return bundleResult(valid.toISOString(), forecastHour, query.includeMembers === true);
    });
    const service = new IfsEnsTimeSeriesService({ bundleGetter: { getBundle } });

    const result = await service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: run.toISOString(),
      endTime: new Date(run.getTime() + 3 * 3_600_000).toISOString(),
      selection: {
        variables: ["wind"],
        pressureLevelsHpa: [850],
        fields: ["wind_10m"],
      },
      members: [...members],
      quantiles,
      includeMembers: true,
      maxMemberSamples: 20,
    });

    expect(result.includeMembers).toBe(true);
    expect(result.series).toHaveLength(2);
    expect(result.series.every((step) => step.members?.length === 2)).toBe(true);
  });

  it("rejects grid drift across native steps", async () => {
    let call = 0;
    const service = new IfsEnsTimeSeriesService({
      bundleGetter: {
        getBundle: async (query) => {
          call += 1;
          const valid = new Date(query.validTime);
          const forecastHour = (valid.getTime() - run.getTime()) / 3_600_000;
          const result = bundleResult(valid.toISOString(), forecastHour);
          return call === 2
            ? { ...result, gridPoint: { latitude: 50.25, longitude: 14.5 } }
            : result;
        },
      },
      stepConcurrency: 1,
    });

    await expect(service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      startTime: run.toISOString(),
      endTime: new Date(run.getTime() + 3 * 3_600_000).toISOString(),
      selection: { fields: ["wind_10m"] },
      members: [...members],
      quantiles,
    })).rejects.toThrow("inconsistent grid points");
  });
});
