import { describe, expect, it } from "vitest";
import { GfsGefsComparisonService } from "../src/core/gfs-gefs-comparison.js";

function gfsResult(value: number) {
  return {
    model: "gfs_0p25" as const,
    run: "2026-08-23T12:00:00.000Z",
    validTime: "2026-08-23T18:00:00.000Z",
    forecastHour: 6,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    levels: [{ pressureHpa: 850, temperatureC: value }],
    source: {
      provider: "NOAA AWS Open Data" as const,
      access: "s3_range" as const,
      decoder: "wgrib2" as const,
      cacheHit: false,
    },
  };
}

function gefsResult(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const populationStdDev = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    model: "gefs_0p50" as const,
    run: "2026-08-23T12:00:00.000Z",
    validTime: "2026-08-23T18:00:00.000Z",
    forecastHour: 6,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: {
      variable: "temperature" as const,
      gfsCode: "TMP",
      pressureLevelHpa: 850,
      outputField: "temperatureC",
      unit: "degC",
    },
    members: values.map((value, index) => ({
      member: (["c00", "p01", "p02"] as const)[index]!,
      value,
      cacheHit: false,
    })),
    summary: {
      memberCount: values.length,
      mean,
      populationStdDev,
      min: Math.min(...values),
      max: Math.max(...values),
      quantiles: [{ quantile: 0.5, value: sorted[Math.floor(sorted.length / 2)]! }],
    },
    source: {
      provider: "NOAA AWS Open Data" as const,
      access: "s3_range" as const,
      decoder: "wgrib2" as const,
      product: "pgrb2a_0p50" as const,
      allCacheHit: false,
    },
  };
}

describe("GfsGefsComparisonService", () => {
  it("places deterministic GFS relative to the aligned GEFS distribution", async () => {
    const service = new GfsGefsComparisonService({
      profileGetter: { getProfile: async () => gfsResult(10) },
      ensembleGetter: { getEnsemble: async () => gefsResult([7, 8, 9]) },
      alignedRunProvider: {
        resolveLatestAlignedRun: async () => new Date("2026-08-23T12:00:00Z"),
      },
    });

    const result = await service.compare({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      validTime: "2026-08-23T18:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p02", "c00", "p01"],
      quantiles: [0.5],
    });

    expect(result.run).toBe("2026-08-23T12:00:00.000Z");
    expect(result.deterministicGfs.value).toBe(10);
    expect(result.gefs.members.map((sample) => sample.member)).toEqual(["c00", "p01", "p02"]);
    expect(result.comparison.deterministicMinusEnsembleMean).toBe(2);
    expect(result.comparison.standardizedDifference).toBeCloseTo(2.449489743, 8);
    expect(result.comparison.membersBelowDeterministic).toBe(3);
    expect(result.comparison.fractionMembersAtOrBelowDeterministic).toBe(1);
    expect(result.comparison.rangePosition).toBe("above_member_max");
    expect(result.comparison.outsideMemberRange).toBe(true);
    expect(result.comparison.interpretation).toBe("raw_model_vs_raw_ensemble_distribution_not_calibrated_uncertainty");
  });

  it("reports an undefined standardized difference when selected members have zero spread", async () => {
    const service = new GfsGefsComparisonService({
      profileGetter: { getProfile: async () => gfsResult(5) },
      ensembleGetter: { getEnsemble: async () => gefsResult([5, 5, 5]) },
      alignedRunProvider: {
        resolveLatestAlignedRun: async () => new Date("2026-08-23T12:00:00Z"),
      },
    });

    const result = await service.compare({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-23T12:00:00Z",
      validTime: "2026-08-23T18:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01", "p02"],
      quantiles: [0.5],
    });

    expect(result.comparison.standardizedDifference).toBeNull();
    expect(result.comparison.rangePosition).toBe("within_member_range");
    expect(result.comparison.outsideMemberRange).toBe(false);
    expect(result.comparison.membersBelowDeterministic).toBe(0);
    expect(result.comparison.membersAtOrBelowDeterministic).toBe(3);
  });
});
