import { describe, expect, it, vi } from "vitest";
import { GfsIfsComparisonService } from "../src/core/gfs-ifs-comparison.js";

const sourceGfs = {
  provider: "NOAA AWS Open Data" as const,
  access: "s3_range" as const,
  decoder: "gribberish" as const,
  cacheHit: true,
};
const sourceIfs = {
  provider: "ECMWF Open Data" as const,
  access: "indexed_http_range" as const,
  decoder: "gribberish" as const,
  product: "ifs_0p25_oper_fc" as const,
  horizontalGridDegrees: 0.25 as const,
  cacheHit: false,
};

describe("GFS/IFS deterministic comparison", () => {
  it("compares normalized canonical outputs on one shared run and valid time", async () => {
    const gfsProfileGetter = {
      getProfile: vi.fn(async () => ({
        model: "gfs_0p25" as const,
        run: "2026-08-28T00:00:00.000Z",
        validTime: "2026-08-28T09:00:00Z",
        forecastHour: 9,
        requestedPoint: { latitude: 50.08, longitude: 14.43 },
        gridPoint: { latitude: 50, longitude: 14.5 },
        levels: [{ pressureHpa: 850, temperatureC: 10 }],
        source: sourceGfs,
      })),
    };
    const ifsProfileGetter = {
      getProfile: vi.fn(async () => ({
        model: "ifs_0p25" as const,
        run: "2026-08-28T00:00:00.000Z",
        validTime: "2026-08-28T09:00:00Z",
        forecastHour: 9,
        requestedPoint: { latitude: 50.08, longitude: 14.43 },
        gridPoint: { latitude: 50, longitude: 14.5 },
        levels: [{ pressureHpa: 850, temperatureC: 12.5 }],
        source: sourceIfs,
      })),
    };
    const service = new GfsIfsComparisonService({
      gfsProfileGetter,
      ifsProfileGetter,
      alignedRunProvider: {
        resolveLatestAlignedRun: vi.fn(async () => new Date("2026-08-28T00:00:00Z")),
      },
    });

    const result = await service.compare({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      validTime: "2026-08-28T09:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
    });

    expect(result.run).toBe("2026-08-28T00:00:00.000Z");
    expect(result.gfs.gridPoint).toEqual({ latitude: 50, longitude: 14.5 });
    expect(result.ifs.gridPoint).toEqual({ latitude: 50, longitude: 14.5 });
    expect(result.comparison.outputs).toEqual([{
      field: "temperatureC",
      unit: "degC",
      gfsValue: 10,
      ifsValue: 12.5,
      ifsMinusGfs: 2.5,
      deltaKind: "linear",
    }]);
    expect(gfsProfileGetter.getProfile).toHaveBeenCalledWith(expect.objectContaining({
      run: "2026-08-28T00:00:00.000Z",
      source: "s3",
    }));
    expect(ifsProfileGetter.getProfile).toHaveBeenCalledWith(expect.objectContaining({
      run: "2026-08-28T00:00:00.000Z",
    }));
  });

  it("uses shortest circular differences for wind direction", async () => {
    const service = new GfsIfsComparisonService({
      gfsProfileGetter: {
        getProfile: vi.fn(async () => ({
          model: "gfs_0p25" as const,
          run: "2026-08-28T00:00:00.000Z",
          validTime: "2026-08-28T09:00:00Z",
          forecastHour: 9,
          requestedPoint: { latitude: 50, longitude: 14 },
          gridPoint: { latitude: 50, longitude: 14 },
          levels: [{ pressureHpa: 850, windSpeedMs: 8, windDirectionDeg: 350 }],
          source: sourceGfs,
        })),
      },
      ifsProfileGetter: {
        getProfile: vi.fn(async () => ({
          model: "ifs_0p25" as const,
          run: "2026-08-28T00:00:00.000Z",
          validTime: "2026-08-28T09:00:00Z",
          forecastHour: 9,
          requestedPoint: { latitude: 50, longitude: 14 },
          gridPoint: { latitude: 50, longitude: 14 },
          levels: [{ pressureHpa: 850, windSpeedMs: 10, windDirectionDeg: 10 }],
          source: sourceIfs,
        })),
      },
    });

    const result = await service.compare({
      latitude: 50,
      longitude: 14,
      run: "2026-08-28T00:00:00Z",
      validTime: "2026-08-28T09:00:00Z",
      variable: "wind",
      pressureLevelHpa: 850,
    });

    expect(result.comparison.outputs).toEqual([
      expect.objectContaining({ field: "windSpeedMs", ifsMinusGfs: 2, deltaKind: "linear" }),
      expect.objectContaining({ field: "windDirectionDeg", ifsMinusGfs: 20, deltaKind: "circular_degrees" }),
    ]);
  });
  it("rejects inconsistent initialization metadata returned by a model source", async () => {
    const service = new GfsIfsComparisonService({
      gfsProfileGetter: {
        getProfile: vi.fn(async () => ({
          model: "gfs_0p25" as const,
          run: "2026-08-28T00:00:00.000Z",
          validTime: "2026-08-28T09:00:00Z",
          forecastHour: 9,
          requestedPoint: { latitude: 50, longitude: 14 },
          gridPoint: { latitude: 50, longitude: 14 },
          levels: [{ pressureHpa: 850, temperatureC: 10 }],
          source: sourceGfs,
        })),
      },
      ifsProfileGetter: {
        getProfile: vi.fn(async () => ({
          model: "ifs_0p25" as const,
          run: "2026-08-27T18:00:00.000Z",
          validTime: "2026-08-28T09:00:00Z",
          forecastHour: 15,
          requestedPoint: { latitude: 50, longitude: 14 },
          gridPoint: { latitude: 50, longitude: 14 },
          levels: [{ pressureHpa: 850, temperatureC: 11 }],
          source: sourceIfs,
        })),
      },
    });

    await expect(service.compare({
      latitude: 50,
      longitude: 14,
      run: "2026-08-28T00:00:00Z",
      validTime: "2026-08-28T09:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
    })).rejects.toThrow("inconsistent initialization cycles");
  });

  it("fails explicitly when a model omits the requested canonical output", async () => {
    const service = new GfsIfsComparisonService({
      gfsProfileGetter: {
        getProfile: vi.fn(async () => ({
          model: "gfs_0p25" as const,
          run: "2026-08-28T00:00:00.000Z",
          validTime: "2026-08-28T09:00:00Z",
          forecastHour: 9,
          requestedPoint: { latitude: 50, longitude: 14 },
          gridPoint: { latitude: 50, longitude: 14 },
          levels: [{ pressureHpa: 850 }],
          source: sourceGfs,
        })),
      },
      ifsProfileGetter: {
        getProfile: vi.fn(async () => ({
          model: "ifs_0p25" as const,
          run: "2026-08-28T00:00:00.000Z",
          validTime: "2026-08-28T09:00:00Z",
          forecastHour: 9,
          requestedPoint: { latitude: 50, longitude: 14 },
          gridPoint: { latitude: 50, longitude: 14 },
          levels: [{ pressureHpa: 850, temperatureC: 11 }],
          source: sourceIfs,
        })),
      },
    });

    await expect(service.compare({
      latitude: 50,
      longitude: 14,
      run: "2026-08-28T00:00:00Z",
      validTime: "2026-08-28T09:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
    })).rejects.toThrow("GFS comparison profile is missing output field temperatureC");
  });

});
