import { describe, expect, it, vi } from "vitest";
import { IfsEnsAreaSummaryService } from "../src/core/ifs-ens-area-summary.js";

const run = new Date("2026-08-27T12:00:00Z");
const validTime = new Date(run.getTime() + 6 * 3_600_000);

describe("IFS ENS member-first area statistics", () => {
  it("computes spatial summaries inside each perturbation before ensemble aggregation", async () => {
    const resolveLatestRun = vi.fn(async () => run);
    const fetchSelection = vi.fn(async (request: {
      selectors: Array<{ number?: number }>;
    }) => {
      const number = request.selectors[0]?.number;
      return { path: `member-${number}`, cacheHit: number === 2 };
    });
    const extractBox = vi.fn(async (path: string) => {
      const member = Number(path.split("-")[1]);
      const base = member === 1 ? 280 : 284;
      return [
        { latitude: 50, longitude: 14, value: base },
        { latitude: 50, longitude: 14.25, value: base + 2 },
      ];
    });
    const service = new IfsEnsAreaSummaryService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractBox },
      latestRunProvider: { resolveLatestRun },
      concurrency: 1,
    });

    const result = await service.summarize({
      westLongitude: 14,
      eastLongitude: 14.25,
      southLatitude: 49.9,
      northLatitude: 50.1,
      run: "latest",
      validTime: validTime.toISOString(),
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p01", "p02"],
      quantiles: [0.5],
      percentiles: [50],
      thresholds: [{ operator: "gte", value: 10 }],
      includeExtremaLocations: true,
      includeMembers: true,
      maxGridPoints: 100,
      maxMemberGridPoints: 200,
    });

    expect(resolveLatestRun).toHaveBeenCalledOnce();
    const selectors = resolveLatestRun.mock.calls[0]?.[1] as Array<{ number?: number }>;
    expect(new Set(selectors.map((selector) => selector.number))).toEqual(new Set([1, 2]));
    expect(fetchSelection).toHaveBeenCalledTimes(2);
    expect(fetchSelection.mock.calls.map(([request]) => request.selectors[0]?.number)).toEqual([1, 2]);

    expect(result.methodology).toBe("spatial_statistics_per_member_then_ensemble_distribution");
    expect(result.statistics.mean.mean).toBeCloseTo(9.85, 8);
    expect(result.statistics.mean.quantiles[0]?.value).toBeCloseTo(9.85, 8);
    expect(result.spatialPercentiles?.[0]?.distribution.mean).toBeCloseTo(9.85, 8);
    expect(result.spatialThresholdFractions?.[0]?.distribution.mean).toBeCloseTo(0.5, 8);
    expect(result.spatialThresholdFractions?.[0]?.interpretation)
      .toBe("distribution_of_raw_member_spatial_fractions_not_calibrated_probability");
    expect(result.memberExtrema).toHaveLength(2);
    expect(result.members).toHaveLength(2);
    expect(result.source.allCacheHit).toBe(false);
    expect(result.source.product).toBe("ifs_0p25_enfo_ef");
  });

  it("fetches shared run-static orography from oper/fc without perturbation numbers", async () => {
    const fetchSelection = vi.fn(async (request: {
      product?: string;
      selectors: Array<{ number?: number; param?: string }>;
    }) => ({
      path: "static-orography",
      cacheHit: true,
    }));
    const extractBox = vi.fn(async () => [
      { latitude: 50, longitude: 14, value: 980.665 },
      { latitude: 50, longitude: 14.25, value: 1961.33 },
    ]);
    const service = new IfsEnsAreaSummaryService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractBox },
      concurrency: 1,
    });

    const result = await service.summarize({
      westLongitude: 14,
      eastLongitude: 14.25,
      southLatitude: 49.9,
      northLatitude: 50.1,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      field: "surface_geopotential_height",
      members: ["p01", "p02"],
      quantiles: [0.5],
      maxGridPoints: 100,
      maxMemberGridPoints: 200,
    });

    expect(fetchSelection).toHaveBeenCalledTimes(2);
    for (const [request] of fetchSelection.mock.calls) {
      expect(request.product).toBe("oper-fc");
      expect(request.selectors[0]?.number).toBeUndefined();
      expect(request.selectors[0]?.param).toBe("z");
    }
    expect(result.statistics.mean.mean).toBeCloseTo(150, 8);
    expect(result.statistics.mean.populationStdDev).toBeCloseTo(0, 8);
    expect(result.selection.field).toBe("surface_geopotential_height");
    expect(result.source.sharedRunStaticProduct).toBe("ifs_0p25_oper_fc");
  });

  it("rejects oversized bbox × perturbation work before source access", async () => {
    const fetchSelection = vi.fn();
    const service = new IfsEnsAreaSummaryService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractBox: vi.fn() },
    });

    await expect(service.summarize({
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 49,
      northLatitude: 50,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p01", "p02"],
      maxGridPoints: 100,
      maxMemberGridPoints: 50,
    })).rejects.toThrow("72 member-grid points");

    expect(fetchSelection).not.toHaveBeenCalled();
  });
});
