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


  it("rejects dataset-specific variable and level mismatches at the comparison boundary", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gfs", "aigfs"],
      variable: "relative_humidity",
    })).toThrow("AIGFS comparison variables");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gfs", "aigfs"],
      pressureLevelHpa: 775,
    })).toThrow("AIGFS does not publish");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs", "aifs"],
      variable: "absolute_vorticity",
    })).toThrow("AIFS does not support comparison variable");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs", "aifs"],
      variable: "specific_humidity",
      pressureLevelHpa: 10,
    })).toThrow("AIFS cannot satisfy");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs", "aifs"],
      variable: "not_a_variable",
    })).toThrow();

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs", "aifs"],
      pressureLevelHpa: 775,
    })).toThrow();

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gefs", "aigefs"],
      pressureLevelHpa: 600,
    })).toThrow("GEFS cannot satisfy");
  });

  it("rejects invalid ensemble member, quantile, and scalar comparison controls", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gefs", "aigefs"],
      gefsMembers: ["c00", "c00"],
    })).toThrow("GEFS member selection must not contain duplicates");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gefs", "aigefs"],
      aigefsMembers: ["c00", "c00"],
    })).toThrow("AIGEFS member selection must not contain duplicates");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gefs", "aigefs"],
      quantiles: [0.5, 0.5],
    })).toThrow("Quantile selection must not contain duplicates");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gefs", "aigefs"],
      variable: "wind",
    })).toThrow("requires one scalar output");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs-ens", "aifs-ens"],
      ifsEnsMembers: ["p01", "p01"],
    })).toThrow("IFS ENS member selection must not contain duplicates");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs-ens", "aifs-ens"],
      aifsEnsMembers: ["c00", "c00"],
    })).toThrow("AIFS ENS member selection must not contain duplicates");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs-ens", "aifs-ens"],
      quantiles: [0.9, 0.9],
    })).toThrow("Quantile selection must not contain duplicates");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs-ens", "aifs-ens"],
      variable: "wind",
    })).toThrow("requires one scalar output");
  });

  it("keeps HGEFS comparisons genuinely hybrid and population-qualified", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["hgefs", "gefs"],
      hgefsMembers: ["gefs:c00", "gefs:p01", "gefs:p02", "aigefs:c00"],
    })).toThrow("at least two selected GEFS and two selected AIGEFS members");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["hgefs", "aigefs"],
      hgefsMembers: ["gefs:c00", "aigefs:c00", "aigefs:p01", "aigefs:p02"],
    })).toThrow();

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["hgefs", "gefs"],
      hgefsMembers: ["gefs:c00", "gefs:c00", "aigefs:c00", "aigefs:p01"],
    })).toThrow("HGEFS member selection must not contain duplicates");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["hgefs", "gefs"],
      hgefsMembers: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
      quantiles: [0.5, 0.5],
    })).toThrow("Quantile selection must not contain duplicates");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["hgefs", "gefs"],
      hgefsMembers: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
      variable: "wind",
    })).toThrow("requires one scalar output");
  });

  it("accepts the ordinary latest selector when both datasets support it", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["gefs", "aigefs"],
      run: "latest",
    })).not.toThrow();
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
