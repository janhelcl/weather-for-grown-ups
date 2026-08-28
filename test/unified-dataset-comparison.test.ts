import { describe, expect, it, vi } from "vitest";
import { UnifiedDatasetComparisonService } from "../src/core/unified-specialized-api.js";
import { compareAtmosphericDatasetsSchema } from "../src/schema/unified-specialized.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

describe("unified dataset comparison", () => {
  it("preserves GFS/GEFS as the default comparison branch", async () => {
    const gfsGefs = { compare: vi.fn(async (query) => ({ route: "gfs-gefs", query })) };
    const gfsIfs = { compare: vi.fn(async (query) => ({ route: "gfs-ifs", query })) };
    const service = new UnifiedDatasetComparisonService(gfsGefs as any, gfsIfs as any);

    const result = await service.compare({
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
    });

    expect(result.datasets).toEqual(["gfs", "gefs"]);
    expect((result.result as any).route).toBe("gfs-gefs");
    expect(gfsGefs.compare).toHaveBeenCalledOnce();
    expect(gfsIfs.compare).not.toHaveBeenCalled();
  });

  it("routes GFS/IFS through deterministic comparison semantics", async () => {
    const gfsGefs = { compare: vi.fn() };
    const gfsIfs = { compare: vi.fn(async (query) => ({ route: "gfs-ifs", query })) };
    const service = new UnifiedDatasetComparisonService(gfsGefs as any, gfsIfs as any);

    const result = await service.compare({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "wind",
      pressureLevelHpa: 850,
      run: "latest",
      gfsGrid: "0p50",
    });

    expect(result.datasets).toEqual(["gfs", "ifs"]);
    expect((result.result as any).route).toBe("gfs-ifs");
    expect(gfsIfs.compare).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2026-08-28T12:00:00Z",
      variable: "wind",
      pressureLevelHpa: 850,
      gfsGrid: "0p50",
    }));
    expect(gfsGefs.compare).not.toHaveBeenCalled();
  });


  it("routes GEFS/IFS ENS through independent ensemble distribution semantics", async () => {
    const gfsGefs = { compare: vi.fn() };
    const gfsIfs = { compare: vi.fn() };
    const gefsIfsEns = { compare: vi.fn(async (query) => ({ route: "gefs-ifs-ens", query })) };
    const service = new UnifiedDatasetComparisonService(
      gfsGefs as any,
      gfsIfs as any,
      gefsIfsEns as any,
    );

    const result = await service.compare({
      datasets: ["gefs", "ifs-ens"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
      run: "latest",
      gefsMembers: ["c00", "p01"],
      ifsEnsMembers: ["p01", "p50"],
      quantiles: [0.1, 0.5, 0.9],
      thresholdGte: 0,
    });

    expect(result.datasets).toEqual(["gefs", "ifs-ens"]);
    expect((result.result as any).route).toBe("gefs-ifs-ens");
    expect(gefsIfsEns.compare).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2026-08-28T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      gefsMembers: ["c00", "p01"],
      ifsEnsMembers: ["p01", "p50"],
      thresholdGte: 0,
    }));
    expect(gfsGefs.compare).not.toHaveBeenCalled();
    expect(gfsIfs.compare).not.toHaveBeenCalled();
  });

  it("rejects GFS-only controls and unsupported pressure selections on GEFS/IFS ENS", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      datasets: ["gefs", "ifs-ens"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
      gfsGrid: "0p25",
    })).toThrow();

    expect(() => compareAtmosphericDatasetsSchema.parse({
      datasets: ["gefs", "ifs-ens"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 600,
    })).toThrow();
  });

  it("rejects ensemble controls on deterministic GFS/IFS comparisons", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
    })).toThrow();
  });

  it("rejects GFS-only pressure variables that IFS does not publish", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "ozone_mixing_ratio",
      pressureLevelHpa: 850,
    })).toThrow();
  });
});
