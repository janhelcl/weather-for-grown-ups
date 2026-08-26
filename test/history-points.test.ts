import { describe, expect, it, vi } from "vitest";
import { AtmosphericBatchPointsService } from "../src/core/atmospheric-batch-points-service.js";
import { HistoricalPointsService } from "../src/core/history-points.js";
import type { HistoricalFieldsResult } from "../src/schema/history-fields.js";
import type { HistoricalProfileResult } from "../src/schema/history-result.js";
import { historicalPointsQuerySchema } from "../src/schema/history-points.js";

const analysisTime = "2017-05-09T12:00:00.000Z";
const requested = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.2, longitude: 16.61 },
];

function profileFor(point: { latitude: number; longitude: number }): HistoricalProfileResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: point,
    gridPoint: {
      latitude: Math.round(point.latitude * 2) / 2,
      longitude: Math.round(point.longitude * 2) / 2,
    },
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    },
    levels: [{ pressureHpa: 850, temperatureC: point.latitude }],
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: "archive.grb2",
      cacheHit: true,
    },
    caveat: "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
  };
}

function fieldsOnlyFor(point: { latitude: number; longitude: number }): HistoricalFieldsResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: point,
    gridPoint: {
      latitude: Math.round(point.latitude * 2) / 2,
      longitude: Math.round(point.longitude * 2) / 2,
    },
    selection: { fields: ["wind_10m"] },
    fields: [{
      id: "wind_10m",
      level: { type: "height_above_ground_m", heightM: 10 },
      temporal: { type: "instantaneous" },
      values: { windSpeedMs: 5, windDirectionDeg: 220 },
    }],
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: "archive.grb2",
      cacheHit: false,
    },
    caveat: "GFS model analysis fields; not direct observations or homogeneous climatological reanalysis",
  };
}

function fieldsFor(point: { latitude: number; longitude: number }): HistoricalFieldsResult {
  const profile = profileFor(point);
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: point,
    gridPoint: profile.gridPoint,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["wind_10m"],
    },
    levels: profile.levels,
    fields: [{
      id: "wind_10m",
      level: { type: "height_above_ground_m", heightM: 10 },
      temporal: { type: "instantaneous" },
      values: { windSpeedMs: 5, windDirectionDeg: 220 },
    }],
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: "archive.grb2",
      cacheHit: true,
    },
    caveat: "GFS model analysis fields; not direct observations or homogeneous climatological reanalysis",
  };
}

describe("HistoricalPointsService", () => {
  it("composes pressure-only point queries serially", async () => {
    let active = 0;
    let maxActive = 0;
    const getHistoricalProfile = vi.fn(async (query: { latitude: number; longitude: number }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return profileFor({ latitude: query.latitude, longitude: query.longitude });
    });
    const service = new HistoricalPointsService({
      profileGetter: { getHistoricalProfile } as never,
      fieldsGetter: { getHistoricalFields: vi.fn() } as never,
    });

    const result = await service.getPoints({
      points: requested,
      analysisTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });

    expect(maxActive).toBe(1);
    expect(getHistoricalProfile).toHaveBeenCalledTimes(2);
    expect(result.points.map((point) => point.requestedPoint)).toEqual(requested);
    expect(result.source.composition).toBe("serial_point_queries");
    expect(result.points.every((point) => point.fields === undefined)).toBe(true);
  });

  it("uses the historical mixed-field primitive when fields are requested", async () => {
    const getHistoricalFields = vi.fn(async (query: { latitude: number; longitude: number }) =>
      fieldsFor({ latitude: query.latitude, longitude: query.longitude }));
    const getHistoricalProfile = vi.fn();
    const service = new HistoricalPointsService({
      fieldsGetter: { getHistoricalFields } as never,
      profileGetter: { getHistoricalProfile } as never,
    });

    const result = await service.getPoints({
      points: requested,
      analysisTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["wind_10m"],
    });

    expect(getHistoricalFields).toHaveBeenCalledTimes(2);
    expect(getHistoricalProfile).not.toHaveBeenCalled();
    expect(result.points[0]?.fields?.[0]).toMatchObject({ id: "wind_10m" });
    expect(result.points[0]?.levels?.[0]).toMatchObject({ pressureHpa: 850 });
  });

  it("supports a fields-only selection without adding a pressure profile", async () => {
    const getHistoricalFields = vi.fn(async (query: { latitude: number; longitude: number }) =>
      fieldsOnlyFor({ latitude: query.latitude, longitude: query.longitude }));
    const service = new HistoricalPointsService({
      fieldsGetter: { getHistoricalFields } as never,
      profileGetter: { getHistoricalProfile: vi.fn() } as never,
    });

    const result = await service.getPoints({
      points: [requested[0]!],
      analysisTime,
      fields: ["wind_10m", "wind_10m"],
    });

    expect(getHistoricalFields).toHaveBeenCalledWith(expect.objectContaining({
      fields: ["wind_10m"],
    }));
    expect(result.selection).toEqual({ fields: ["wind_10m"] });
    expect(result.points[0]?.levels).toBeUndefined();
    expect(result.points[0]?.cacheHit).toBe(false);
  });

  it("validates pressure-selection pairs and requires at least one selection", () => {
    expect(historicalPointsQuerySchema.safeParse({
      points: [requested[0]],
      analysisTime,
      fields: ["wind_10m"],
    }).success).toBe(true);

    for (const invalid of [
      { points: [requested[0]], analysisTime },
      { points: [requested[0]], analysisTime, variables: ["temperature"] },
      { points: [requested[0]], analysisTime, pressureLevelsHpa: [850] },
    ]) {
      expect(historicalPointsQuerySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("participates in shared atmospheric points dispatch", async () => {
    const history = new HistoricalPointsService({
      profileGetter: { getHistoricalProfile: async (query) => profileFor(query) },
      fieldsGetter: { getHistoricalFields: async (query) => fieldsFor(query) },
    });
    const service = new AtmosphericBatchPointsService({
      history,
      gfs: { getPoints: vi.fn() } as never,
      gefs: { getPoints: vi.fn() } as never,
    });

    const result = await service.getPoints({
      model: "gfs_grid4_analysis_0p5",
      query: {
        points: requested,
        analysisTime,
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });

    expect(result.model).toBe("gfs_grid4_analysis_0p5");
    expect("run" in result).toBe(false);
  });

  it("rejects more than ten points before archive work", async () => {
    const getHistoricalProfile = vi.fn();
    const service = new HistoricalPointsService({
      profileGetter: { getHistoricalProfile } as never,
      fieldsGetter: { getHistoricalFields: vi.fn() } as never,
    });

    await expect(service.getPoints({
      points: Array.from({ length: 11 }, (_, index) => ({ latitude: 50, longitude: index })),
      analysisTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).rejects.toThrow();

    expect(getHistoricalProfile).not.toHaveBeenCalled();
  });
});
