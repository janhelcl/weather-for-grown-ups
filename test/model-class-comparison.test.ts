import { describe, expect, it, vi } from "vitest";
import {
  ModelClassComparisonService,
  type ModelClassComparisonQueryService,
} from "../src/core/model-class-comparison.js";
import type { QueryAtmosphereInput } from "../src/schema/unified-api.js";

const run = "2026-08-31T00:00:00.000Z";
const validTime = "2026-08-31T06:00:00.000Z";

function wrapped(dataset: string, result: unknown): any {
  return {
    dataset,
    internalDatasetId: "gfs_0p25",
    role: "forecast",
    kind: dataset.includes("ens") || dataset === "gefs" || dataset === "aigefs"
      ? "ensemble"
      : "deterministic",
    geometryType: "point",
    timeType: "instant",
    result,
  };
}

function deterministicResult(
  model: string,
  resolvedRun: string,
  temperatureC: number,
  provider: string,
) {
  return {
    model,
    run: resolvedRun,
    validTime,
    forecastHour: 6,
    requestedPoint: { latitude: 50, longitude: 14 },
    gridPoint: { latitude: 50, longitude: 14 },
    levels: [{ pressureHpa: 850, temperatureC }],
    source: { provider, cacheHit: true },
  };
}

function distribution(values: readonly number[], quantiles = [0.1, 0.5, 0.9]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return {
    memberCount: sorted.length,
    mean,
    populationStdDev: Math.sqrt(variance),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    quantiles: quantiles.map((quantile) => ({
      quantile,
      value: quantile === 0.5
        ? sorted[Math.floor((sorted.length - 1) / 2)]!
        : quantile < 0.5 ? sorted[0]! : sorted[sorted.length - 1]!,
    })),
  };
}

function aiEnsembleResult(
  model: string,
  values: readonly number[],
  members: readonly string[],
  provider: string,
) {
  return {
    model,
    run,
    validTime,
    forecastHour: 6,
    requestedPoint: { latitude: 50, longitude: 14 },
    gridPoint: { latitude: 50, longitude: 14 },
    pressureSummaries: [{
      pressureLevelHpa: 850,
      field: "temperatureC",
      aggregation: "numeric_distribution",
      distribution: distribution(values),
    }],
    members: members.map((member, index) => ({
      member,
      cacheHit: true,
      levels: [{ pressureHpa: 850, temperatureC: values[index % values.length]! }],
    })),
    source: { provider, allCacheHit: true },
  };
}

function gefsEnsembleResult(
  values: readonly number[],
  members: readonly string[],
) {
  return {
    model: "gefs_0p50",
    run,
    validTime,
    forecastHour: 6,
    requestedPoint: { latitude: 50, longitude: 14 },
    gridPoint: { latitude: 50, longitude: 14 },
    pressureSummaries: [{
      variable: "temperature",
      pressureLevelHpa: 850,
      outputField: "temperatureC",
      unit: "degC",
      distribution: distribution(values),
    }],
    members: members.map((member, index) => ({
      member,
      cacheHit: true,
      pressureValues: [{
        variable: "temperature",
        pressureLevelHpa: 850,
        value: values[index % values.length]!,
      }],
      fields: [],
    })),
    source: { provider: "NOAA AWS Open Data", allCacheHit: true },
  };
}

function ifsEnsResult(
  values: readonly number[],
  members: readonly string[],
) {
  return {
    model: "ifs_ens_0p25",
    run,
    validTime,
    forecastHour: 6,
    requestedPoint: { latitude: 50, longitude: 14 },
    gridPoint: { latitude: 50, longitude: 14 },
    pressureSummaries: [{
      variable: "temperature",
      pressureLevelHpa: 850,
      outputs: [{
        field: "temperatureC",
        unit: "degC",
        aggregation: "numeric_distribution",
        distribution: distribution(values),
      }],
    }],
    members: members.map((member, index) => ({
      member,
      cacheHit: true,
      pressureValues: [{
        variable: "temperature",
        pressureLevelHpa: 850,
        values: { temperatureC: values[index % values.length]! },
      }],
      fields: [],
    })),
    source: { provider: "ECMWF Open Data", allCacheHit: true },
  };
}

describe("model-class comparison mechanics", () => {
  it("aligns latest deterministic physics and AI forecasts onto one shared cycle", async () => {
    const calls: QueryAtmosphereInput[] = [];
    const service = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        calls.push(input);
        const requestedRun = input.forecast?.run ?? "latest";
        if (input.dataset === "gfs") {
          const resolved = requestedRun === "latest"
            ? "2026-08-31T12:00:00.000Z"
            : String(requestedRun);
          return wrapped("gfs", deterministicResult("gfs_0p25", resolved, 10, "NOAA"));
        }
        const resolved = requestedRun === "latest"
          ? "2026-08-31T06:00:00.000Z"
          : String(requestedRun);
        return wrapped(
          "aigfs",
          deterministicResult("aigfs_0p25", resolved, 12, "NOAA NOMADS"),
        );
      }),
    } satisfies ModelClassComparisonQueryService);

    const result: any = await service.compareDeterministic({
      datasets: ["gfs", "aigfs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run: "latest",
      variable: "temperature",
      pressureLevelHpa: 850,
    });

    expect(result.run).toBe("2026-08-31T06:00:00.000Z");
    expect(result.comparison.outputs[0]).toMatchObject({
      field: "temperatureC",
      leftValue: 10,
      rightValue: 12,
      rightMinusLeft: 2,
      deltaKind: "linear",
    });
    expect(calls).toHaveLength(3);
    expect(calls.filter((call) =>
      call.dataset === "gfs" && call.forecast?.run === "2026-08-31T06:00:00.000Z"
    )).toHaveLength(1);
  });

  it("preserves native IFS ENS and AIFS ENS populations instead of forcing symmetry", async () => {
    const calls: QueryAtmosphereInput[] = [];
    const fake: ModelClassComparisonQueryService = {
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        calls.push(input);
        const members = input.ensemble?.members ?? [];
        const values = members.map((_, index) => 5 + index / 10);
        return wrapped(
          input.dataset,
          input.dataset === "ifs-ens"
            ? ifsEnsResult(values, members)
            : aiEnsembleResult("aifs_ens_0p25", values, members, "ECMWF Open Data"),
        );
      }),
    };
    const service = new ModelClassComparisonService(fake);

    const result: any = await service.compareEnsembles({
      datasets: ["ifs-ens", "aifs-ens"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      quantiles: [0.1, 0.5, 0.9],
      thresholdGte: 7,
    });

    const ifsMembers = calls.find((call) => call.dataset === "ifs-ens")!.ensemble!.members!;
    const aifsMembers = calls.find((call) => call.dataset === "aifs-ens")!.ensemble!.members!;
    expect(ifsMembers).toHaveLength(50);
    expect(ifsMembers[0]).toBe("p01");
    expect(ifsMembers).not.toContain("c00");
    expect(aifsMembers).toHaveLength(51);
    expect(aifsMembers[0]).toBe("c00");
    expect(result.left.memberCount).toBe(50);
    expect(result.right.memberCount).toBe(51);
    expect(result.comparison.interpretation).toBe(
      "independent_raw_ensemble_distributions_no_member_pairing_not_calibrated_uncertainty",
    );
  });

  it("compares GEFS and AIGEFS as independent distributions with raw threshold fractions", async () => {
    const fake: ModelClassComparisonQueryService = {
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        const members = input.ensemble?.members ?? [];
        const values = input.dataset === "gefs" ? [8, 10, 12] : [10, 12, 14];
        return wrapped(
          input.dataset,
          input.dataset === "gefs"
            ? gefsEnsembleResult(values, members)
            : aiEnsembleResult("aigefs_0p25", values, members, "NOAA"),
        );
      }),
    };
    const service = new ModelClassComparisonService(fake);

    const result: any = await service.compareEnsembles({
      datasets: ["gefs", "aigefs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      leftMembers: ["c00", "p01", "p02"],
      rightMembers: ["c00", "p01", "p02"],
      quantiles: [0.1, 0.5, 0.9],
      thresholdGte: 11,
    });

    expect(result.comparison.rightMinusLeftMean).toBe(2);
    expect(result.comparison.threshold).toMatchObject({
      leftCount: 1,
      leftFraction: 1 / 3,
      rightCount: 2,
      rightFraction: 2 / 3,
      rightMinusLeftFraction: 1 / 3,
      interpretation: "raw_member_fractions_not_calibrated_probabilities",
    });
  });

  it("compares HGEFS with a constituent from the same hybrid payload and marks the overlap", async () => {
    const fake: ModelClassComparisonQueryService = {
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        expect(input.dataset).toBe("hgefs");
        return wrapped("hgefs", {
          model: "hgefs_0p25",
          run,
          validTime,
          forecastHour: 6,
          constituentGridPoints: [
            { population: "gefs", gridPoint: { latitude: 50, longitude: 14 } },
            { population: "aigefs", gridPoint: { latitude: 50, longitude: 14.25 } },
          ],
          members: [
            {
              member: "gefs:c00",
              population: "gefs",
              levels: [{ pressureHpa: 850, temperatureC: 10 }],
            },
            {
              member: "gefs:p01",
              population: "gefs",
              levels: [{ pressureHpa: 850, temperatureC: 12 }],
            },
            {
              member: "aigefs:c00",
              population: "aigefs",
              levels: [{ pressureHpa: 850, temperatureC: 14 }],
            },
            {
              member: "aigefs:p01",
              population: "aigefs",
              levels: [{ pressureHpa: 850, temperatureC: 16 }],
            },
          ],
          source: {
            provider: "NOAA",
            constituents: [
              { population: "gefs", source: { provider: "NOAA AWS Open Data" } },
              { population: "aigefs", source: { provider: "NOAA EAGLE AWS Open Data" } },
            ],
          },
        });
      }),
    };
    const service = new ModelClassComparisonService(fake);

    const result: any = await service.compareHybridConstituent({
      constituent: "gefs",
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
      quantiles: [0.1, 0.5, 0.9],
    });

    expect(result.hgefs.summary.mean).toBe(13);
    expect(result.constituent.summary.mean).toBe(11);
    expect(result.comparison.constituentMinusHybridMean).toBe(-2);
    expect(result.comparison.interpretation).toBe(
      "overlapping_hybrid_and_constituent_raw_distributions_not_independent_not_calibrated_uncertainty",
    );
    expect(result.constituent.source).toEqual({ provider: "NOAA AWS Open Data" });
  });
});
