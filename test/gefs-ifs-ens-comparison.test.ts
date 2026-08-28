import { describe, expect, it, vi } from "vitest";
import { GefsIfsEnsComparisonService } from "../src/core/gefs-ifs-ens-comparison.js";

const gefsSource = {
  provider: "NOAA AWS Open Data" as const,
  access: "s3_range" as const,
  decoder: "gribberish" as const,
  product: "pgrb2a_0p50" as const,
  horizontalGridDegrees: 0.5 as const,
  allCacheHit: true,
};

const ifsSource = {
  provider: "ECMWF Open Data" as const,
  access: "indexed_http_range" as const,
  decoder: "gribberish" as const,
  product: "ifs_0p25_enfo_ef" as const,
  horizontalGridDegrees: 0.25 as const,
  allCacheHit: false,
  memberSemantics: "50_perturbed_members_control_is_oper_fc" as const,
};

function gefsBundle(overrides: Record<string, unknown> = {}) {
  return {
    model: "gefs_0p50" as const,
    run: "2026-08-28T00:00:00.000Z",
    validTime: "2026-08-28T12:00:00.000Z",
    forecastHour: 12,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: [],
      members: ["c00", "p01"],
      quantiles: [0.1, 0.5, 0.9],
    },
    pressureSummaries: [{
      variable: "temperature",
      pressureLevelHpa: 850,
      outputField: "temperatureC",
      unit: "degC",
      distribution: {
        memberCount: 2,
        mean: 11,
        populationStdDev: 1,
        min: 10,
        max: 12,
        quantiles: [
          { quantile: 0.1, value: 10.2 },
          { quantile: 0.5, value: 11 },
          { quantile: 0.9, value: 11.8 },
        ],
      },
    }],
    fieldSummaries: [],
    members: [
      {
        member: "c00",
        cacheHit: true,
        pressureValues: [{ variable: "temperature", pressureLevelHpa: 850, value: 10 }],
        fields: [],
      },
      {
        member: "p01",
        cacheHit: true,
        pressureValues: [{ variable: "temperature", pressureLevelHpa: 850, value: 12 }],
        fields: [],
      },
    ],
    source: gefsSource,
    ...overrides,
  };
}

function ifsBundle(overrides: Record<string, unknown> = {}) {
  return {
    model: "ifs_ens_0p25" as const,
    run: "2026-08-28T00:00:00.000Z",
    validTime: "2026-08-28T12:00:00.000Z",
    forecastHour: 12,
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
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
        aggregation: "numeric_distribution" as const,
        field: "temperatureC",
        unit: "degC",
        distribution: {
          memberCount: 2,
          mean: 13,
          populationStdDev: 2,
          min: 11,
          max: 15,
          quantiles: [
            { quantile: 0.1, value: 11.4 },
            { quantile: 0.5, value: 13 },
            { quantile: 0.9, value: 14.6 },
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
          values: { temperatureC: 11 },
        }],
        fields: [],
      },
      {
        member: "p02",
        cacheHit: false,
        pressureValues: [{
          variable: "temperature",
          pressureLevelHpa: 850,
          values: { temperatureC: 15 },
        }],
        fields: [],
      },
    ],
    source: ifsSource,
    ...overrides,
  };
}

describe("GEFS / IFS ENS comparison", () => {
  it("compares independently summarized ensemble distributions without pairing members", async () => {
    const gefsBundleGetter = { getBundle: vi.fn(async () => gefsBundle()) };
    const ifsEnsBundleGetter = { getBundle: vi.fn(async () => ifsBundle()) };
    const alignedRunProvider = {
      resolveLatestAlignedRun: vi.fn(async () => new Date("2026-08-28T00:00:00Z")),
    };
    const service = new GefsIfsEnsComparisonService({
      gefsBundleGetter: gefsBundleGetter as any,
      ifsEnsBundleGetter: ifsEnsBundleGetter as any,
      alignedRunProvider,
    });

    const result = await service.compare({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      validTime: "2026-08-28T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      gefsMembers: ["c00", "p01"],
      ifsEnsMembers: ["p01", "p02"],
      quantiles: [0.1, 0.5, 0.9],
      thresholdGte: 12.5,
    });

    expect(result.run).toBe("2026-08-28T00:00:00.000Z");
    expect(result.gefs.gridPoint).toEqual({ latitude: 50, longitude: 14.5 });
    expect(result.ifsEns.gridPoint).toEqual({ latitude: 50, longitude: 14.5 });
    expect(result.comparison.ifsEnsMinusGefsMean).toBe(2);
    expect(result.comparison.ifsEnsMinusGefsPopulationStdDev).toBe(1);
    expect(result.comparison.populationStdDevRatioIfsEnsToGefs).toBe(2);
    expect(result.comparison.quantileShifts).toEqual([
      { quantile: 0.1, gefsValue: 10.2, ifsEnsValue: 11.4, ifsEnsMinusGefs: 1.200000000000001 },
      { quantile: 0.5, gefsValue: 11, ifsEnsValue: 13, ifsEnsMinusGefs: 2 },
      { quantile: 0.9, gefsValue: 11.8, ifsEnsValue: 14.6, ifsEnsMinusGefs: 2.8 },
    ]);
    expect(result.comparison.threshold).toEqual({
      operator: "gte",
      value: 12.5,
      gefsCount: 0,
      gefsFraction: 0,
      ifsEnsCount: 1,
      ifsEnsFraction: 0.5,
      ifsEnsMinusGefsFraction: 0.5,
      interpretation: "raw_member_fractions_not_calibrated_probabilities",
    });
    expect(result.comparison.interpretation).toBe(
      "independent_raw_ensemble_distributions_no_member_pairing_not_calibrated_uncertainty",
    );

    expect(gefsBundleGetter.getBundle).toHaveBeenCalledWith(expect.objectContaining({
      run: "2026-08-28T00:00:00.000Z",
      includeMembers: true,
      members: ["c00", "p01"],
    }));
    expect(ifsEnsBundleGetter.getBundle).toHaveBeenCalledWith(expect.objectContaining({
      run: "2026-08-28T00:00:00.000Z",
      includeMembers: true,
      members: ["p01", "p02"],
    }));
  });

  it("returns a null spread ratio when GEFS has zero selected-member spread", async () => {
    const noSpread = gefsBundle({
      pressureSummaries: [{
        variable: "temperature",
        pressureLevelHpa: 850,
        outputField: "temperatureC",
        unit: "degC",
        distribution: {
          memberCount: 2,
          mean: 11,
          populationStdDev: 0,
          min: 11,
          max: 11,
          quantiles: [{ quantile: 0.5, value: 11 }],
        },
      }],
      members: undefined,
    });
    const ifs = ifsBundle({
      pressureSummaries: [{
        variable: "temperature",
        pressureLevelHpa: 850,
        outputs: [{
          aggregation: "numeric_distribution",
          field: "temperatureC",
          unit: "degC",
          distribution: {
            memberCount: 2,
            mean: 13,
            populationStdDev: 2,
            min: 11,
            max: 15,
            quantiles: [{ quantile: 0.5, value: 13 }],
          },
        }],
      }],
      members: undefined,
    });
    const service = new GefsIfsEnsComparisonService({
      gefsBundleGetter: { getBundle: vi.fn(async () => noSpread) } as any,
      ifsEnsBundleGetter: { getBundle: vi.fn(async () => ifs) } as any,
    });

    const result = await service.compare({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-28T00:00:00Z",
      validTime: "2026-08-28T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      gefsMembers: ["c00", "p01"],
      ifsEnsMembers: ["p01", "p02"],
      quantiles: [0.5],
    });

    expect(result.comparison.populationStdDevRatioIfsEnsToGefs).toBeNull();
  });

  it("rejects mismatched canonical output units rather than comparing unlike values", async () => {
    const badIfs = ifsBundle({
      pressureSummaries: [{
        variable: "temperature",
        pressureLevelHpa: 850,
        outputs: [{
          aggregation: "numeric_distribution",
          field: "temperatureC",
          unit: "K",
          distribution: {
            memberCount: 2,
            mean: 286,
            populationStdDev: 2,
            min: 284,
            max: 288,
            quantiles: [{ quantile: 0.5, value: 286 }],
          },
        }],
      }],
    });
    const service = new GefsIfsEnsComparisonService({
      gefsBundleGetter: {
        getBundle: vi.fn(async () => gefsBundle({
          pressureSummaries: [{
            variable: "temperature",
            pressureLevelHpa: 850,
            outputField: "temperatureC",
            unit: "degC",
            distribution: {
              memberCount: 2,
              mean: 11,
              populationStdDev: 1,
              min: 10,
              max: 12,
              quantiles: [{ quantile: 0.5, value: 11 }],
            },
          }],
        })),
      } as any,
      ifsEnsBundleGetter: { getBundle: vi.fn(async () => badIfs) } as any,
    });

    await expect(service.compare({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-28T00:00:00Z",
      validTime: "2026-08-28T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      gefsMembers: ["c00", "p01"],
      ifsEnsMembers: ["p01", "p02"],
      quantiles: [0.5],
    })).rejects.toThrow("output unit mismatch");
  });
});
