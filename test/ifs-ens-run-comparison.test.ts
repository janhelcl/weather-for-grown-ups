import { describe, expect, it, vi } from "vitest";
import { IfsEnsRunComparisonService } from "../src/core/ifs-ens-run-comparison.js";
import type { IfsEnsMemberBundleResult } from "../src/schema/ifs-ens.js";

const anchorRun = new Date("2026-08-27T12:00:00Z");
const validTime = new Date("2026-09-01T12:00:00Z");
const gridPoint = { latitude: 50, longitude: 14.5 };

function bundleResult(run: Date, mean: number, values = [mean - 1, mean + 1]): IfsEnsMemberBundleResult {
  const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
  return {
    model: "ifs_ens_0p25",
    run: run.toISOString(),
    validTime: validTime.toISOString(),
    forecastHour,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: [],
      members: ["p01", "p02"],
      quantiles: [0.1, 0.5, 0.9],
    },
    pressureSummaries: [{
      variable: "temperature",
      pressureLevelHpa: 850,
      outputs: [{
        aggregation: "numeric_distribution",
        field: "temperatureC",
        unit: "degC",
        distribution: {
          memberCount: 2,
          mean,
          populationStdDev: 1,
          min: mean - 1,
          max: mean + 1,
          quantiles: [
            { quantile: 0.1, value: mean - 0.8 },
            { quantile: 0.5, value: mean },
            { quantile: 0.9, value: mean + 0.8 },
          ],
        },
      }],
    }],
    fieldSummaries: [],
    members: [
      {
        member: "p01",
        cacheHit: false,
        pressureValues: [{
          variable: "temperature",
          pressureLevelHpa: 850,
          values: { temperatureC: values[0]! },
        }],
        fields: [],
      },
      {
        member: "p02",
        cacheHit: true,
        pressureValues: [{
          variable: "temperature",
          pressureLevelHpa: 850,
          values: { temperatureC: values[1]! },
        }],
        fields: [],
      },
    ],
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

describe("IFS ENS run comparison", () => {
  it("compares independently summarized distributions across a 12-hour long-cycle stride", async () => {
    const getBundle = vi.fn(async (query: { run: string }) => {
      const run = new Date(query.run);
      const hoursOlder = (anchorRun.getTime() - run.getTime()) / 3_600_000;
      const mean = 10 + (24 - hoursOlder) / 12;
      return bundleResult(run, mean);
    });
    const service = new IfsEnsRunComparisonService({
      bundleGetter: { getBundle },
      concurrency: 2,
    });

    const result = await service.compareRuns({
      latitude: 50.08,
      longitude: 14.43,
      anchorRun: anchorRun.toISOString(),
      validTime: validTime.toISOString(),
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p01", "p02"],
      quantiles: [0.1, 0.5, 0.9],
      cycles: 3,
      cycleStrideHours: 12,
    });

    expect(result.runs.map((snapshot) => snapshot.run)).toEqual([
      "2026-08-26T12:00:00.000Z",
      "2026-08-27T00:00:00.000Z",
      "2026-08-27T12:00:00.000Z",
    ]);
    expect(result.runs.map((snapshot) => snapshot.forecastHour)).toEqual([144, 132, 120]);
    expect(result.cycleStrideHours).toBe(12);
    expect(result.comparisons).toHaveLength(2);
    expect(result.comparisons.every((comparison) =>
      comparison.interpretation === "distribution_shift_between_model_cycles_not_member_trajectory")).toBe(true);
    expect(result.comparisons[0]?.mean.delta).toBeCloseTo(1);
    expect(result.comparisons[0]?.quantiles.find((item) => item.quantile === 0.5)?.delta).toBeCloseTo(1);
  });

  it("computes threshold-fraction shifts from hidden perturbation values", async () => {
    const getBundle = vi.fn(async (query: { run: string; includeMembers?: boolean }) => {
      const run = new Date(query.run);
      const isAnchor = run.getTime() === anchorRun.getTime();
      return bundleResult(run, isAnchor ? 12 : 10, isAnchor ? [11, 13] : [9, 11]);
    });
    const service = new IfsEnsRunComparisonService({ bundleGetter: { getBundle } });

    const result = await service.compareRuns({
      latitude: 50.08,
      longitude: 14.43,
      anchorRun: anchorRun.toISOString(),
      validTime: validTime.toISOString(),
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p01", "p02"],
      quantiles: [0.5],
      thresholdGte: 12,
      cycles: 2,
      cycleStrideHours: 12,
    });

    expect(getBundle.mock.calls.every(([query]) => query.includeMembers === true)).toBe(true);
    expect(result.runs[0]?.summary.threshold).toMatchObject({ count: 0, fraction: 0 });
    expect(result.runs[1]?.summary.threshold).toMatchObject({ count: 1, fraction: 0.5 });
    expect(result.comparisons[0]?.thresholdFraction).toEqual({
      operator: "gte",
      threshold: 12,
      from: 0,
      to: 0.5,
      delta: 0.5,
    });
  });

  it("resolves latest using the complete perturbation selection", async () => {
    const resolveLatestRun = vi.fn(async () => anchorRun);
    const getBundle = vi.fn(async (query: { run: string }) => bundleResult(new Date(query.run), 10));
    const service = new IfsEnsRunComparisonService({
      latestRunProvider: { resolveLatestRun },
      bundleGetter: { getBundle },
    });

    await service.compareRuns({
      latitude: 50.08,
      longitude: 14.43,
      anchorRun: "latest",
      validTime: validTime.toISOString(),
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p01", "p50"],
      quantiles: [0.5],
      cycles: 2,
    });

    expect(resolveLatestRun).toHaveBeenCalledOnce();
    const selectors = resolveLatestRun.mock.calls[0]?.[1] as Array<{ number?: number }>;
    expect(new Set(selectors.map((selector) => selector.number))).toEqual(new Set([1, 50]));
  });

  it("rejects grid drift across cycles", async () => {
    let call = 0;
    const service = new IfsEnsRunComparisonService({
      bundleGetter: {
        getBundle: async (query) => {
          call += 1;
          const result = bundleResult(new Date(query.run), 10 + call);
          return call === 2
            ? { ...result, gridPoint: { latitude: 50.25, longitude: 14.5 } }
            : result;
        },
      },
      concurrency: 1,
    });

    await expect(service.compareRuns({
      latitude: 50.08,
      longitude: 14.43,
      anchorRun: anchorRun.toISOString(),
      validTime: validTime.toISOString(),
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p01", "p02"],
      cycles: 2,
    })).rejects.toThrow("grid point changed across model cycles");
  });
});
