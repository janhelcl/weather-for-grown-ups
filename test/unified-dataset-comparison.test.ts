import { describe, expect, it, vi } from "vitest";
import {
  GefsIfsEnsDatasetComparisonAdapter,
  GfsGefsDatasetComparisonAdapter,
  GfsIfsDatasetComparisonAdapter,
  IfsIfsEnsDatasetComparisonAdapter,
} from "../src/core/specialized-adapters/dataset-comparison.js";
import { compareAtmosphericDatasetsSchema } from "../src/schema/unified-specialized.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

describe("unified dataset-comparison adapters", () => {
  it("maps GFS/GEFS into native aligned comparison semantics", async () => {
    const native = { compare: vi.fn(async (query) => ({ route: "gfs-gefs", query })) };
    const adapter = new GfsGefsDatasetComparisonAdapter(native as any);
    const request = compareAtmosphericDatasetsSchema.parse({
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
      quantiles: [0.25, 0.75],
    });
    const result = await adapter.compare(request);
    expect((result as any).route).toBe("gfs-gefs");
    expect(native.compare).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2026-08-28T12:00:00Z",
      members: ["c00", "p01"],
      quantiles: [0.25, 0.75],
    }));
  });

  it("maps GFS/IFS into deterministic comparison semantics", async () => {
    const native = { compare: vi.fn(async (query) => ({ route: "gfs-ifs", query })) };
    const adapter = new GfsIfsDatasetComparisonAdapter(native as any);
    const request = compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "wind",
      pressureLevelHpa: 850,
      gfsGrid: "0p50",
    });
    await adapter.compare(request);
    expect(native.compare).toHaveBeenCalledWith(expect.objectContaining({
      variable: "wind",
      pressureLevelHpa: 850,
      gfsGrid: "0p50",
    }));
  });

  it("maps GEFS/IFS ENS without inventing member trajectories", async () => {
    const native = { compare: vi.fn(async (query) => ({ route: "gefs-ifs-ens", query })) };
    const adapter = new GefsIfsEnsDatasetComparisonAdapter(native as any);
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
    await adapter.compare(request);
    expect(native.compare).toHaveBeenCalledWith(expect.objectContaining({
      gefsMembers: ["c00", "p01"],
      ifsEnsMembers: ["p01", "p50"],
      thresholdGte: 0,
    }));
  });

  it("maps deterministic IFS against the IFS ENS distribution", async () => {
    const native = { compare: vi.fn(async (query) => ({ route: "ifs-ifs-ens", query })) };
    const adapter = new IfsIfsEnsDatasetComparisonAdapter(native as any);
    const request = compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs", "ifs-ens"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "absolute_vorticity",
      pressureLevelHpa: 850,
      ifsEnsMembers: ["p01", "p50"],
      quantiles: [0.1, 0.5, 0.9],
    });
    await adapter.compare(request);
    expect(native.compare).toHaveBeenCalledWith(expect.objectContaining({
      members: ["p01", "p50"],
      quantiles: [0.1, 0.5, 0.9],
    }));
  });

  it("guards each adapter against the wrong comparison pair", async () => {
    const native = { compare: vi.fn() };
    const gfsGefs = new GfsGefsDatasetComparisonAdapter(native as any);
    const gfsIfs = new GfsIfsDatasetComparisonAdapter(native as any);
    const gefsIfsEns = new GefsIfsEnsDatasetComparisonAdapter(native as any);
    const ifsIfsEns = new IfsIfsEnsDatasetComparisonAdapter(native as any);
    const request = compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    await expect(gfsGefs.compare(request)).rejects.toThrow("datasets=gfs,gefs");
    await expect(gefsIfsEns.compare(request)).rejects.toThrow("datasets=gefs,ifs-ens");
    await expect(ifsIfsEns.compare(request)).rejects.toThrow("datasets=ifs,ifs-ens");
    await expect(gfsIfs.compare(request)).resolves.toBeUndefined();
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
}
