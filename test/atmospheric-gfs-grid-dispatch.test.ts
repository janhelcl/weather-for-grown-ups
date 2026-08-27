import { describe, expect, it, vi } from "vitest";
import { AtmosphericAreaSummaryService } from "../src/core/atmospheric-area-summary-service.js";
import { AtmosphericBatchPointsService } from "../src/core/atmospheric-batch-points-service.js";
import { AtmosphericPointsTimeSeriesService } from "../src/core/atmospheric-points-timeseries-service.js";
import { AtmosphericTransectService } from "../src/core/atmospheric-transect-service.js";

describe("model-neutral GFS 0.5 geometry dispatch", () => {
  it("injects 0p50 for batch points", async () => {
    const getPoints = vi.fn(async (query: any) => ({ route: "points", query }));
    const service = new AtmosphericBatchPointsService({ gfs: { getPoints } as any });
    const result: any = await service.getPoints({
      model: "gfs_0p50",
      query: {
        points: [{ latitude: 50, longitude: 14 }],
        run: "2026-08-27T00:00:00Z",
        validTime: "2026-08-27T06:00:00Z",
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });
    expect(result.route).toBe("points");
    expect(getPoints).toHaveBeenCalledWith(expect.objectContaining({ grid: "0p50" }));
  });

  it("injects 0p50 for multi-point time series", async () => {
    const getPointsTimeSeries = vi.fn(async (query: any) => ({ route: "points-series", query }));
    const service = new AtmosphericPointsTimeSeriesService({
      gfs: { getPointsTimeSeries } as any,
    });
    const result: any = await service.getPointsTimeSeries({
      model: "gfs_0p50",
      query: {
        points: [{ latitude: 50, longitude: 14 }],
        run: "2026-08-27T00:00:00Z",
        startTime: "2026-08-27T00:00:00Z",
        endTime: "2026-08-27T06:00:00Z",
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });
    expect(result.route).toBe("points-series");
    expect(getPointsTimeSeries).toHaveBeenCalledWith(
      expect.objectContaining({ grid: "0p50" }),
    );
  });

  it("injects 0p50 for transects", async () => {
    const getTransect = vi.fn(async (query: any) => ({ route: "transect", query }));
    const service = new AtmosphericTransectService({ gfs: { getTransect } as any });
    const result: any = await service.getTransect({
      model: "gfs_0p50",
      query: {
        start: { latitude: 49.5, longitude: 14 },
        end: { latitude: 50, longitude: 15 },
        run: "2026-08-27T00:00:00Z",
        validTime: "2026-08-27T06:00:00Z",
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });
    expect(result.route).toBe("transect");
    expect(getTransect).toHaveBeenCalledWith(expect.objectContaining({ grid: "0p50" }));
  });

  it("injects 0p50 for area summaries", async () => {
    const summarize = vi.fn(async (query: any) => ({ route: "area", query }));
    const service = new AtmosphericAreaSummaryService({ gfs: { summarize } as any });
    const result: any = await service.summarize({
      model: "gfs_0p50",
      query: {
        westLongitude: 13.5,
        eastLongitude: 14.5,
        southLatitude: 49.5,
        northLatitude: 50.5,
        run: "2026-08-27T00:00:00Z",
        validTime: "2026-08-27T06:00:00Z",
        variable: "temperature",
        pressureLevelHpa: 850,
      },
    });
    expect(result.route).toBe("area");
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({ grid: "0p50" }));
  });
});
