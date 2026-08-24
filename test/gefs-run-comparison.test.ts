import { describe, expect, it } from "vitest";
import { AtmosphericRunComparisonService } from "../src/core/atmospheric-run-comparison-service.js";
import { GefsRunComparisonService } from "../src/core/gefs-run-comparison.js";
import type { GefsMember } from "../src/catalog/gefs.js";
import type { GefsEnsembleQueryInput, GefsEnsembleResult } from "../src/schema/gefs-ensemble.js";

const anchor = new Date("2026-08-23T12:00:00.000Z");
const validTime = "2026-08-23T18:00:00.000Z";
const members = ["c00", "p01", "p02"] as GefsMember[];

function resultFor(query: GefsEnsembleQueryInput): GefsEnsembleResult {
  const run = new Date(String(query.run));
  const forecastHour = (new Date(query.validTime).getTime() - run.getTime()) / 3_600_000;
  const cycleHour = run.getUTCHours();
  const mean = cycleHour === 0 ? 5 : cycleHour === 6 ? 6.5 : 8;
  const spread = cycleHour === 0 ? 2 : cycleHour === 6 ? 1.5 : 1;
  const thresholdFraction = cycleHour === 0 ? 1 / 3 : cycleHour === 6 ? 2 / 3 : 1;
  const selectedMembers = query.members ?? members;
  const quantiles = [...(query.quantiles ?? [0.1, 0.5, 0.9])].sort((a, b) => a - b);

  return {
    model: "gefs_0p50",
    run: run.toISOString(),
    validTime: query.validTime,
    forecastHour,
    requestedPoint: { latitude: query.latitude, longitude: query.longitude },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: {
      variable: "temperature",
      gfsCode: "TMP",
      pressureLevelHpa: 850,
      outputField: "temperatureC",
      unit: "degC",
    },
    members: selectedMembers.map((member, index) => ({ member, value: mean + index - 1, cacheHit: false })),
    summary: {
      memberCount: selectedMembers.length,
      mean,
      populationStdDev: spread,
      min: mean - 2,
      max: mean + 2,
      quantiles: quantiles.map((quantile) => ({ quantile, value: mean + (quantile - 0.5) * 2 })),
      ...(query.thresholdGte === undefined ? {} : {
        threshold: {
          operator: "gte" as const,
          value: query.thresholdGte,
          count: Math.round(thresholdFraction * selectedMembers.length),
          fraction: thresholdFraction,
          interpretation: "raw_member_fraction_not_calibrated_probability" as const,
        },
      }),
    },
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      product: "pgrb2a_0p50",
      allCacheHit: false,
    },
  };
}

describe("GefsRunComparisonService", () => {
  it("compares distribution descriptors across consecutive cycles without member trajectories", async () => {
    const calls: GefsEnsembleQueryInput[] = [];
    const service = new GefsRunComparisonService({
      latestRunProvider: { resolveLatestRun: async (_validTime: Date, selectedMembers: readonly GefsMember[]) => {
        expect(selectedMembers).toEqual(members);
        return anchor;
      } },
      ensembleGetter: {
        getEnsemble: async (query) => {
          calls.push(query);
          return resultFor(query);
        },
      },
      concurrency: 1,
    });

    const result = await service.compareRuns({
      latitude: 50.08,
      longitude: 14.43,
      anchorRun: "latest",
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members,
      quantiles: [0.9, 0.1, 0.5],
      thresholdGte: 7,
      cycles: 3,
    });

    expect(result.model).toBe("gefs_0p50");
    expect(result.anchorRun).toBe(anchor.toISOString());
    expect(result.selection.members).toEqual(members);
    expect(result.selection.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(result.runs.map((run) => [run.run, run.forecastHour])).toEqual([
      ["2026-08-23T00:00:00.000Z", 18],
      ["2026-08-23T06:00:00.000Z", 12],
      ["2026-08-23T12:00:00.000Z", 6],
    ]);
    expect(calls.map((call) => call.run)).toEqual(result.runs.map((run) => run.run));

    expect(result.comparisons).toHaveLength(2);
    expect(result.comparisons[0]?.mean).toEqual({ from: 5, to: 6.5, delta: 1.5 });
    expect(result.comparisons[0]?.populationStdDev).toEqual({ from: 2, to: 1.5, delta: -0.5 });
    expect(result.comparisons[1]?.mean).toEqual({ from: 6.5, to: 8, delta: 1.5 });
    expect(result.comparisons[1]?.thresholdFraction).toMatchObject({
      operator: "gte",
      threshold: 7,
      from: 2 / 3,
      to: 1,
    });
    expect(result.comparisons[1]?.thresholdFraction?.delta).toBeCloseTo(1 / 3);
    expect(result.comparisons.every((comparison) =>
      comparison.interpretation === "distribution_shift_between_model_cycles_not_member_trajectory",
    )).toBe(true);
    expect(JSON.stringify(result.comparisons)).not.toContain("p01");
  });

  it("rejects grid drift across cycles", async () => {
    let count = 0;
    const service = new GefsRunComparisonService({
      ensembleGetter: {
        getEnsemble: async (query) => {
          count += 1;
          const result = resultFor(query);
          return count === 2 ? { ...result, gridPoint: { latitude: 49.5, longitude: 14.5 } } : result;
        },
      },
      concurrency: 1,
    });

    await expect(service.compareRuns({
      latitude: 50.08,
      longitude: 14.43,
      anchorRun: anchor.toISOString(),
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members,
      cycles: 2,
    })).rejects.toThrow("grid point changed across model cycles");
  });

  it("dispatches through the model-neutral run comparison operation", async () => {
    const expected = { model: "gefs_0p50" } as never;
    const atmospheric = new AtmosphericRunComparisonService({
      gefs: { compareRuns: async () => expected },
    });
    await expect(atmospheric.compareRuns({
      model: "gefs_0p50",
      query: {
        latitude: 50.08,
        longitude: 14.43,
        anchorRun: anchor.toISOString(),
        validTime,
        variable: "temperature",
        pressureLevelHpa: 850,
        members,
        cycles: 2,
      },
    })).resolves.toBe(expected);
  });
});
