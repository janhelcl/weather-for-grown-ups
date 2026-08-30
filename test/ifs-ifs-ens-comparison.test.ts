import { describe, expect, it, vi } from "vitest";
import { IfsIfsEnsComparisonService } from "../src/core/ifs-ifs-ens-comparison.js";

const run = "2026-08-23T12:00:00.000Z";
const validTime = "2026-08-23T18:00:00.000Z";
const requestedPoint = { latitude: 50.08, longitude: 14.43 };
const gridPoint = { latitude: 50, longitude: 14.5 };

function ifsResult(
  variable: "temperature" | "dew_point",
  value: number,
) {
  return {
    model: "ifs_0p25" as const,
    run,
    validTime,
    forecastHour: 6,
    requestedPoint,
    gridPoint,
    levels: [{
      pressureHpa: 850,
      ...(variable === "temperature"
        ? { temperatureC: value }
        : { dewPointC: value }),
    }],
    source: {
      provider: "ECMWF Open Data" as const,
      access: "indexed_http_range" as const,
      decoder: "gribberish" as const,
      product: "ifs_0p25_oper_fc" as const,
      horizontalGridDegrees: 0.25 as const,
      cacheHit: false,
    },
  };
}

function ifsEnsResult(
  variable: "temperature" | "dew_point",
  outputField: "temperatureC" | "dewPointC",
  unit: "degC",
  values: number[],
) {
  const members = ["p01", "p02", "p03"] as const;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const populationStdDev = Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  );
  const sorted = [...values].sort((a, b) => a - b);
  return {
    model: "ifs_ens_0p25" as const,
    run,
    validTime,
    forecastHour: 6,
    requestedPoint,
    gridPoint,
    selection: {
      variables: [variable],
      pressureLevelsHpa: [850],
      fields: [],
      members: members.slice(0, values.length),
      quantiles: [0.5],
    },
    pressureSummaries: [{
      variable,
      pressureLevelHpa: 850,
      outputs: [{
        aggregation: "numeric_distribution" as const,
        field: outputField,
        unit,
        distribution: {
          memberCount: values.length,
          mean,
          populationStdDev,
          min: Math.min(...values),
          max: Math.max(...values),
          quantiles: [{ quantile: 0.5, value: sorted[Math.floor(sorted.length / 2)]! }],
        },
      }],
    }],
    fieldSummaries: [],
    members: values.map((value, index) => ({
      member: members[index]!,
      cacheHit: false,
      pressureValues: [{
        variable,
        pressureLevelHpa: 850,
        values: { [outputField]: value },
      }],
      fields: [],
    })),
    source: {
      provider: "ECMWF Open Data" as const,
      access: "indexed_http_range" as const,
      decoder: "gribberish" as const,
      product: "ifs_0p25_enfo_ef" as const,
      horizontalGridDegrees: 0.25 as const,
      allCacheHit: false,
      memberSemantics: "50_perturbed_members_control_is_oper_fc" as const,
    },
  };
}

describe("IfsIfsEnsComparisonService", () => {
  it("places deterministic IFS control relative to the perturbed ENS distribution", async () => {
    let ensembleQuery: any;
    const service = new IfsIfsEnsComparisonService({
      ifsGetter: { getProfile: async () => ifsResult("temperature", 10) },
      ifsEnsGetter: {
        getBundle: async (query) => {
          ensembleQuery = query;
          return ifsEnsResult("temperature", "temperatureC", "degC", [7, 8, 9]);
        },
      },
      alignedRunProvider: {
        resolveLatestAlignedRun: async () => new Date(run),
      },
    });

    const result = await service.compare({
      ...requestedPoint,
      run: "latest",
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p03", "p01", "p02"],
      quantiles: [0.5],
    });

    expect(ensembleQuery.members).toEqual(["p01", "p02", "p03"]);
    expect(ensembleQuery.includeMembers).toBe(true);
    expect(result.deterministicIfs.value).toBe(10);
    expect(result.ifsEns.members.map((sample) => sample.member))
      .toEqual(["p01", "p02", "p03"]);
    expect(result.comparison.deterministicMinusEnsembleMean).toBe(2);
    expect(result.comparison.standardizedDifference).toBeCloseTo(2.449489743, 8);
    expect(result.comparison.membersBelowDeterministic).toBe(3);
    expect(result.comparison.fractionMembersAtOrBelowDeterministic).toBe(1);
    expect(result.comparison.rangePosition).toBe("above_member_max");
    expect(result.comparison.outsideMemberRange).toBe(true);
    expect(result.comparison.interpretation).toBe(
      "deterministic_ifs_control_vs_perturbed_ensemble_distribution_not_calibrated_uncertainty",
    );
  });

  it("uses the canonical scalar output for derived pressure variables", async () => {
    const service = new IfsIfsEnsComparisonService({
      ifsGetter: { getProfile: async () => ifsResult("dew_point", 5) },
      ifsEnsGetter: {
        getBundle: async () =>
          ifsEnsResult("dew_point", "dewPointC", "degC", [4, 5, 6]),
      },
      alignedRunProvider: {
        resolveLatestAlignedRun: async () => new Date(run),
      },
    });

    const result = await service.compare({
      ...requestedPoint,
      run: "latest",
      validTime,
      variable: "dew_point",
      pressureLevelHpa: 850,
      members: ["p01", "p02", "p03"],
      quantiles: [0.5],
    });

    expect(result.selection.outputField).toBe("dewPointC");
    expect(result.selection.unit).toBe("degC");
    expect(result.deterministicIfs.value).toBe(5);
    expect(result.comparison.rangePosition).toBe("within_member_range");
  });

  it("reports null standardized difference for zero perturbed spread", async () => {
    const service = new IfsIfsEnsComparisonService({
      ifsGetter: { getProfile: async () => ifsResult("temperature", 5) },
      ifsEnsGetter: {
        getBundle: async () =>
          ifsEnsResult("temperature", "temperatureC", "degC", [5, 5, 5]),
      },
      alignedRunProvider: {
        resolveLatestAlignedRun: async () => new Date(run),
      },
    });

    const result = await service.compare({
      ...requestedPoint,
      run,
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p01", "p02", "p03"],
      quantiles: [0.5],
    });

    expect(result.comparison.standardizedDifference).toBeNull();
    expect(result.comparison.membersBelowDeterministic).toBe(0);
    expect(result.comparison.membersAtOrBelowDeterministic).toBe(3);
    expect(result.comparison.outsideMemberRange).toBe(false);
  });

  it("rejects drift between deterministic and ensemble metadata", async () => {
    const ensemble = ifsEnsResult(
      "temperature",
      "temperatureC",
      "degC",
      [4, 5, 6],
    );
    const service = new IfsIfsEnsComparisonService({
      ifsGetter: { getProfile: async () => ifsResult("temperature", 5) },
      ifsEnsGetter: {
        getBundle: async () => ({ ...ensemble, forecastHour: 9 }),
      },
      alignedRunProvider: {
        resolveLatestAlignedRun: async () => new Date(run),
      },
    });

    await expect(service.compare({
      ...requestedPoint,
      run: "latest",
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p01", "p02", "p03"],
      quantiles: [0.5],
    })).rejects.toThrow("inconsistent valid-time semantics");
  });
});
