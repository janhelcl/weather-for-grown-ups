import { describe, expect, it } from "vitest";
import { createAtmosphericDatasetComparisonStrategyRegistry } from "../src/core/comparison-strategies/registry.js";
import { compareAtmosphericDatasetsSchema } from "../src/schema/unified-specialized.js";

const base = {
  geometry: { type: "point" as const, latitude: 50, longitude: 14 },
  time: { at: "2026-08-31T06:00:00.000Z" },
  run: "2026-08-31T00:00:00.000Z",
  variable: "temperature",
  pressureLevelHpa: 850,
};

describe("AI and hybrid comparison registry contract", () => {
  it.each([
    ["gfs", "aigfs"],
    ["ifs", "aifs"],
    ["aigfs", "aifs"],
    ["gefs", "aigefs"],
    ["ifs-ens", "aifs-ens"],
    ["hgefs", "gefs"],
    ["hgefs", "aigefs"],
  ] as const)("accepts the explicit %s:%s comparison family", (left, right) => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: [left, right],
    })).not.toThrow();
  });

  it("preserves native ensemble defaults in the public comparison contract", () => {
    const noaa: any = compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gefs", "aigefs"],
    });
    expect(noaa.gefsMembers).toHaveLength(31);
    expect(noaa.aigefsMembers).toHaveLength(31);

    const ecmwf: any = compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs-ens", "aifs-ens"],
    });
    expect(ecmwf.ifsEnsMembers).toBeUndefined();
    expect(ecmwf.aifsEnsMembers).toHaveLength(51);
    expect(ecmwf.aifsEnsMembers[0]).toBe("c00");

    const hybrid: any = compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["hgefs", "gefs"],
    });
    expect(hybrid.hgefsMembers).toHaveLength(62);
  });

  it("accepts latest_complete only where every dataset supports it", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gfs", "aigfs"],
      run: "latest_complete",
    })).not.toThrow();
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs", "aifs"],
      run: "latest_complete",
    })).toThrow();
  });

  it("rejects pair-irrelevant comparison controls instead of silently discarding them", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gfs", "aigfs"],
      quantiles: [0.5],
    })).toThrow();
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gefs", "aigefs"],
      ifsEnsMembers: ["p01", "p02"],
    })).toThrow();
  });

  it("remains restrictive rather than accepting arbitrary queryable pairs", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gfs", "aifs"],
    })).toThrow();
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["aifs", "gfs"],
    })).toThrow();
  });

  it("declares model-class and hybrid comparison semantics in registry metadata", () => {
    const registry = createAtmosphericDatasetComparisonStrategyRegistry();

    expect(registry["gfs:aigfs"].metadata).toMatchObject({
      comparisonSemantics: "deterministic_delta",
      outputShape: "normalized_pair_result",
      provenanceShape: "native_source_per_side",
      left: { modelClass: "physics", resultKind: "deterministic", provider: "noaa" },
      right: { modelClass: "ai", resultKind: "deterministic", provider: "noaa" },
    });
    expect(registry["ifs-ens:aifs-ens"].metadata).toMatchObject({
      comparisonSemantics: "ensemble_distribution_shift",
      left: { modelClass: "physics", resultKind: "ensemble", provider: "ecmwf" },
      right: { modelClass: "ai", resultKind: "ensemble", provider: "ecmwf" },
    });
    expect(registry["hgefs:gefs"].metadata).toMatchObject({
      comparisonSemantics: "hybrid_constituent_distribution_shift",
      outputShape: "hybrid_constituent_result",
      provenanceShape: "hybrid_constituent_sources",
      left: { modelClass: "hybrid", resultKind: "ensemble", provider: "noaa" },
      right: { modelClass: "physics", resultKind: "ensemble", provider: "noaa" },
    });
  });
});
