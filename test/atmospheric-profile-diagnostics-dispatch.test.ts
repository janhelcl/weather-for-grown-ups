import { describe, expect, it, vi } from "vitest";
import { AtmosphericProfileDiagnosticsService } from "../src/core/atmospheric-profile-diagnostics-service.js";
import type { ProfileDiagnosticsResult } from "../src/core/types.js";
import type { GefsProfileDiagnosticsResult } from "../src/schema/gefs-profile-diagnostics.js";

const gfsResult: ProfileDiagnosticsResult = {
  model: "gfs_0p25",
  run: "2026-08-23T12:00:00Z",
  validTime: "2026-08-23T18:00:00Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  sampledPressureLevelsHpa: [850, 500],
  levels: [
    { pressureHpa: 850, temperatureC: 5, geopotentialHeightGpm: 1500 },
    { pressureHpa: 500, temperatureC: -20, geopotentialHeightGpm: 5500 },
  ],
  diagnostics: [{ id: "freezing_level_crossings", crossings: [] }],
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", cacheHit: true },
};

const distribution = {
  memberCount: 2,
  mean: 0.5,
  populationStdDev: 0.5,
  min: 0,
  max: 1,
  quantiles: [{ quantile: 0.5, value: 0.5 }],
};

const gefsResult: GefsProfileDiagnosticsResult = {
  model: "gefs_0p50",
  run: gfsResult.run,
  validTime: gfsResult.validTime,
  forecastHour: 6,
  requestedPoint: gfsResult.requestedPoint,
  gridPoint: gfsResult.gridPoint,
  sampledPressureLevelsHpa: [850, 500],
  selection: {
    diagnostics: ["freezing_level_crossings"],
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  summaries: [{
    id: "freezing_level_crossings",
    membersWithAnyCrossing: {
      count: 1,
      memberCount: 2,
      fraction: 0.5,
      interpretation: "raw_member_fraction_not_calibrated_probability",
    },
    crossingCount: distribution,
  }],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    product: "pgrb2a_0p50",
    allCacheHit: true,
  },
};

describe("atmospheric profile diagnostics dispatch", () => {
  it("routes deterministic requests to GFS", async () => {
    const getProfileDiagnostics = vi.fn(async () => gfsResult);
    const service = new AtmosphericProfileDiagnosticsService({
      gfs: { getProfileDiagnostics },
      gefs: { getProfileDiagnostics: async () => gefsResult },
    });
    const result = await service.getProfileDiagnostics({
      model: "gfs_0p25",
      query: {
        latitude: 50.08,
        longitude: 14.43,
        run: gfsResult.run,
        validTime: gfsResult.validTime,
        pressureLevelsHpa: [850, 500],
        diagnostics: ["freezing_level_crossings"],
        source: "s3",
      },
    });
    expect(result.model).toBe("gfs_0p25");
    expect(getProfileDiagnostics).toHaveBeenCalledOnce();
  });

  it("forces the 0.5 grid for deterministic profile diagnostics", async () => {
    const gfs50Result: ProfileDiagnosticsResult = { ...gfsResult, model: "gfs_0p50" };
    const getProfileDiagnostics = vi.fn(async (query: any) =>
      query.grid === "0p50" ? gfs50Result : gfsResult
    );
    const service = new AtmosphericProfileDiagnosticsService({
      gfs: { getProfileDiagnostics },
      gefs: { getProfileDiagnostics: async () => gefsResult },
    });
    const result = await service.getProfileDiagnostics({
      model: "gfs_0p50",
      query: {
        latitude: 50.08,
        longitude: 14.43,
        run: gfsResult.run,
        validTime: gfsResult.validTime,
        pressureLevelsHpa: [850, 500],
        diagnostics: ["freezing_level_crossings"],
        source: "s3",
      },
    });
    expect(result.model).toBe("gfs_0p50");
    expect(getProfileDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ grid: "0p50" }));
  });

  it("routes ensemble requests to GEFS", async () => {
    const getProfileDiagnostics = vi.fn(async () => gefsResult);
    const service = new AtmosphericProfileDiagnosticsService({
      gfs: { getProfileDiagnostics: async () => gfsResult },
      gefs: { getProfileDiagnostics },
    });
    const result = await service.getProfileDiagnostics({
      model: "gefs_0p50",
      query: {
        latitude: 50.08,
        longitude: 14.43,
        run: gefsResult.run,
        validTime: gefsResult.validTime,
        pressureLevelsHpa: [850, 500],
        diagnostics: ["freezing_level_crossings"],
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
    });
    expect(result.model).toBe("gefs_0p50");
    expect(getProfileDiagnostics).toHaveBeenCalledOnce();
  });
});
