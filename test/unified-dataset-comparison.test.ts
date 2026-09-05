import { describe, expect, it, vi } from "vitest";
import { createAtmosphericDatasetComparisonStrategyRegistry } from "../src/core/comparison-strategies/registry.js";
import {
  GefsIfsEnsComparisonStrategy,
  GfsGefsComparisonStrategy,
  GfsIfsComparisonStrategy,
  IfsIfsEnsComparisonStrategy,
} from "../src/core/comparison-strategies/strategies.js";
import { UnifiedDatasetComparisonService } from "../src/core/unified-specialized-api.js";
import { PUBLIC_DATASET_METADATA } from "../src/schema/unified-api.js";
import { compareAtmosphericDatasetsSchema } from "../src/schema/unified-specialized.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

describe("unified dataset-comparison strategies", () => {
  it("maps GFS/GEFS into native aligned comparison semantics", async () => {
    const native = { compare: vi.fn(async (query) => ({ route: "gfs-gefs", query })) };
    const strategy = new GfsGefsComparisonStrategy(native as any);
    const request = compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "gefs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
      quantiles: [0.25, 0.75],
    });
    const result = await strategy.compare(request);
    expect((result as any).route).toBe("gfs-gefs");
    expect(native.compare).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2026-08-28T12:00:00Z",
      members: ["c00", "p01"],
      quantiles: [0.25, 0.75],
    }));
  });

  it("maps GFS/IFS into deterministic comparison semantics", async () => {
    const native = { compare: vi.fn(async (query) => ({ route: "gfs-ifs", query })) };
    const strategy = new GfsIfsComparisonStrategy(native as any);
    const request = compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "wind",
      pressureLevelHpa: 850,
      gfsGrid: "0p50",
    });
    await strategy.compare(request);
    expect(native.compare).toHaveBeenCalledWith(expect.objectContaining({
      variable: "wind",
      pressureLevelHpa: 850,
      gfsGrid: "0p50",
    }));
  });

  it("maps GEFS/IFS ENS without inventing member trajectories", async () => {
    const native = { compare: vi.fn(async (query) => ({ route: "gefs-ifs-ens", query })) };
    const strategy = new GefsIfsEnsComparisonStrategy(native as any);
    const request = compareAtmosphericDatasetsSchema.parse({
      datasets: ["gefs", "ifs-ens"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
      gefsMembers: ["c00", "p01"],
      ifsEnsMembers: ["p01", "p50"],
      quantiles: [0.1, 0.5, 0.9],
      thresholdGte: 0,
    });
    await strategy.compare(request);
    expect(native.compare).toHaveBeenCalledWith(expect.objectContaining({
      gefsMembers: ["c00", "p01"],
      ifsEnsMembers: ["p01", "p50"],
      thresholdGte: 0,
    }));
  });

  it("maps deterministic IFS against the IFS ENS distribution", async () => {
    const native = { compare: vi.fn(async (query) => ({ route: "ifs-ifs-ens", query })) };
    const strategy = new IfsIfsEnsComparisonStrategy(native as any);
    const request = compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs", "ifs-ens"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "absolute_vorticity",
      pressureLevelHpa: 850,
      ifsEnsMembers: ["p01", "p50"],
      quantiles: [0.1, 0.5, 0.9],
    });
    await strategy.compare(request);
    expect(native.compare).toHaveBeenCalledWith(expect.objectContaining({
      members: ["p01", "p50"],
      quantiles: [0.1, 0.5, 0.9],
    }));
  });

  it("preserves omitted pair-specific controls", async () => {
    const native = { compare: vi.fn(async (query) => query) };

    const gfsGefs = new GfsGefsComparisonStrategy(native as any);
    await gfsGefs.compare(compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "gefs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
      gfsGrid: "0p50",
    }));
    expect(native.compare.mock.calls.at(-1)![0]).toMatchObject({
      gfsGrid: "0p50",
      variable: "temperature",
      pressureLevelHpa: 850,
    });

    const gfsIfs = new GfsIfsComparisonStrategy(native as any);
    await gfsIfs.compare(compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    }));
    expect(native.compare.mock.calls.at(-1)![0]).not.toHaveProperty("gfsGrid");

    const gefsIfsEns = new GefsIfsEnsComparisonStrategy(native as any);
    await gefsIfsEns.compare(compareAtmosphericDatasetsSchema.parse({
      datasets: ["gefs", "ifs-ens"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    }));
    expect(native.compare.mock.calls.at(-1)![0]).toMatchObject({
      variable: "temperature",
      pressureLevelHpa: 850,
    });

    const ifsIfsEns = new IfsIfsEnsComparisonStrategy(native as any);
    await ifsIfsEns.compare(compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs", "ifs-ens"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    }));
    expect(native.compare.mock.calls.at(-1)![0]).toMatchObject({
      variable: "temperature",
      pressureLevelHpa: 850,
    });
  });

  it("guards each strategy against the wrong comparison pair", async () => {
    const native = { compare: vi.fn(async () => undefined) };
    const gfsGefs = new GfsGefsComparisonStrategy(native as any);
    const gfsIfs = new GfsIfsComparisonStrategy(native as any);
    const gefsIfsEns = new GefsIfsEnsComparisonStrategy(native as any);
    const ifsIfsEns = new IfsIfsEnsComparisonStrategy(native as any);
    const request = compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    expect(() => gfsGefs.compare(request)).toThrow("datasets=gfs,gefs");
    expect(() => gefsIfsEns.compare(request)).toThrow("datasets=gefs,ifs-ens");
    expect(() => ifsIfsEns.compare(request)).toThrow("datasets=ifs,ifs-ens");
    await expect(gfsIfs.compare(request)).resolves.toBeUndefined();

    const gfsGefsRequest = compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "gefs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    expect(() => gfsIfs.compare(gfsGefsRequest)).toThrow("datasets=gfs,ifs");
  });
});


describe("comparison strategy registry", () => {
  it("declares restrictive scientific semantics from dataset metadata", () => {
    const registry = createAtmosphericDatasetComparisonStrategyRegistry();
    expect(Object.keys(registry).sort()).toEqual([
      "aigfs:aifs",
      "gefs:aigefs",
      "gefs:ifs-ens",
      "gfs:aigfs",
      "gfs:gefs",
      "gfs:ifs",
      "hgefs:aigefs",
      "hgefs:gefs",
      "gfs:icon-d2",
      "ifs:arome",
      "ifs:icon-d2",
      "ifs-ens:icon-d2-eps",
      "ifs-ens:pe-arome",
      "ifs:aifs",
      "ifs:ifs-ens",
      "ifs-ens:aifs-ens",
    ].sort());

    expect(registry["gfs:gefs"].metadata).toMatchObject({
      datasets: ["gfs", "gefs"],
      left: { resultKind: "deterministic", modelClass: "physics", provider: "noaa" },
      right: { resultKind: "ensemble", modelClass: "physics", provider: "noaa" },
      runAlignment: "shared_initialization_cycle",
      validTimeAlignment: "exact",
      variableCompatibility: "pair_specific_pressure_scalar_intersection",
      comparisonSemantics: "deterministic_ensemble_positioning",
      outputShape: "pair_native_result",
      provenanceShape: "native_source_per_dataset",
    });
    expect(registry["gfs:ifs"].metadata.comparisonSemantics).toBe("deterministic_delta");
    expect(registry["gefs:ifs-ens"].metadata.comparisonSemantics).toBe("ensemble_distribution_shift");
    expect(registry["ifs:icon-d2"].metadata).toMatchObject({
      runAlignment: "shared_explicit_initialization_cycle",
      variableCompatibility: "pair_specific_pressure_or_field_intersection",
      spatialOverlapRequirement: "requested_point_within_both_declared_domains",
      pointSamplingSemantics: "independent_dataset_sampling_at_same_requested_coordinate",
      spatialAlignment: "point_only_no_cross_dataset_regridding",
      nativeResolutionRepresentation: "preserve_per_side_native_grid_and_sampling_provenance",
      crossScale: {
        initializationHoursUtc: [0, 6, 12, 18],
        validTimeCadenceHours: 3,
        maxLeadHours: 48,
        pressure: {
          variables: expect.arrayContaining(["temperature", "vertical_velocity"]),
          pressureLevelsHpa: [300, 400, 500, 600, 700, 850, 925, 1000],
          scalarOnly: false,
        },
        fields: {
          ids: ["temperature_2m", "u_wind_10m", "v_wind_10m", "wind_10m"],
          temporalSemantics: "instantaneous",
          scalarOnly: false,
        },
        diagnostics: [],
        comparisonLayerInterpolation: "none",
        comparisonLayerRegridding: "none",
        aggregation: "none_deterministic",
      },
      left: { spatialDomain: { scope: "global" } },
      right: {
        spatialDomain: { scope: "limited_area" },
        nativeGrid: { type: "icosahedral" },
      },
    });

    for (const strategy of Object.values(registry)) {
      for (const side of [strategy.metadata.left, strategy.metadata.right]) {
        const metadata = PUBLIC_DATASET_METADATA[side.dataset];
        expect(side).toMatchObject({
          resultKind: metadata.kind,
          modelClass: metadata.modelClass,
          provider: metadata.provider,
        });
      }
    }
  });

  it("routes the public comparison service through the selected strategy", async () => {
    const base = createAtmosphericDatasetComparisonStrategyRegistry()["gfs:ifs"];
    const compare = vi.fn(async () => ({ route: "custom-strategy" }));
    const service = new UnifiedDatasetComparisonService({
      strategies: {
        "gfs:ifs": { metadata: base.metadata, compare },
      },
    });
    const result = await service.compare({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    expect(compare).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      operation: "compare_datasets",
      datasets: ["gfs", "ifs"],
      result: { route: "custom-strategy" },
    });
  });

  it("rejects strategy declarations that drift from their registry key", () => {
    const base = createAtmosphericDatasetComparisonStrategyRegistry()["gfs:gefs"];
    expect(() => createAtmosphericDatasetComparisonStrategyRegistry({
      "gfs:gefs": {
        metadata: { ...base.metadata, key: "gfs:ifs" },
        compare: base.compare.bind(base),
      } as any,
    })).toThrow("registry key gfs:gefs");
  });
});

describe("unified dataset-comparison schema", () => {
  it("rejects invalid IFS/IFS ENS controls", () => {
    const base = {
      datasets: ["ifs", "ifs-ens"] as const,
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature" as const,
      pressureLevelHpa: 850,
    };
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      ifsEnsMembers: ["p01", "p01"],
    })).toThrow("IFS ENS member selection must not contain duplicates");
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      quantiles: [0.5, 0.5],
    })).toThrow("Quantile selection must not contain duplicates");
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      gfsGrid: "0p25",
    })).toThrow();
  });

  it("rejects invalid GEFS/IFS ENS controls and unsupported selections", () => {
    const base = {
      datasets: ["gefs", "ifs-ens"] as const,
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature" as const,
      pressureLevelHpa: 850,
    };
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      gefsMembers: ["p01", "p01"],
    })).toThrow("GEFS member selection must not contain duplicates");
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      ifsEnsMembers: ["p01", "p01"],
    })).toThrow("IFS ENS member selection must not contain duplicates");
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      quantiles: [0.5, 0.5],
    })).toThrow("Quantile selection must not contain duplicates");
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      gfsGrid: "0p25",
    })).toThrow();
    expect(() => compareAtmosphericDatasetsSchema.parse({
      ...base,
      pressureLevelHpa: 600,
    })).toThrow();
  });

  it("rejects ensemble controls and GFS-only variables on deterministic GFS/IFS", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
    })).toThrow();
    expect(() => compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "ozone_mixing_ratio",
      pressureLevelHpa: 850,
    })).toThrow();
  });
});
