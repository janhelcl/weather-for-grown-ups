import { describe, expect, it, vi } from "vitest";
import { AtmosphericPointsTimeSeriesService } from "../src/core/atmospheric-points-timeseries-service.js";
import { HistoricalPointsTimeSeriesService } from "../src/core/history-points-timeseries.js";
import type { HistoricalPointsResult } from "../src/schema/history-points.js";
import { historicalPointsTimeSeriesQuerySchema } from "../src/schema/history-points-timeseries.js";

const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.2, longitude: 16.61 },
];

function batch(analysisTime: string): HistoricalPointsResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    },
    points: points.map((point) => ({
      requestedPoint: point,
      gridPoint: {
        latitude: Math.round(point.latitude * 2) / 2,
        longitude: Math.round(point.longitude * 2) / 2,
      },
      levels: [{ pressureHpa: 850, temperatureC: point.latitude }],
      dataset: "archive.grb2",
      cacheHit: true,
    })),
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      composition: "serial_point_queries",
    },
    caveat: "GFS model analysis; not direct observations or homogeneous climatological reanalysis",
  };
}

describe("HistoricalPointsTimeSeriesService", () => {
  it("composes selected analysis cycles serially over the historical points primitive", async () => {
    let active = 0;
    let maxActive = 0;
    const getPoints = vi.fn(async (query: { analysisTime: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return batch(new Date(query.analysisTime).toISOString());
    });
    const service = new HistoricalPointsTimeSeriesService({
      pointsGetter: { getPoints } as never,
      now: () => new Date("2017-05-10T00:00:00Z"),
    });

    const result = await service.getPointsTimeSeries({
      points,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-09T06:00:00Z",
      cycleHoursUtc: [0, 6],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxSteps: 2,
      maxPointSteps: 4,
    });

    expect(maxActive).toBe(1);
    expect(getPoints).toHaveBeenCalledTimes(2);
    expect(result.series).toHaveLength(2);
    expect(result.source.composition).toBe("serial_cycle_point_queries");
    expect(result.series[1]?.points[0]?.gridPoint).toEqual(result.series[0]?.points[0]?.gridPoint);
  });

  it("guards the point-step matrix before archive work", async () => {
    const getPoints = vi.fn();
    const service = new HistoricalPointsTimeSeriesService({
      pointsGetter: { getPoints } as never,
      now: () => new Date("2017-05-10T00:00:00Z"),
    });

    await expect(service.getPointsTimeSeries({
      points,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-09T12:00:00Z",
      cycleHoursUtc: [0, 6, 12],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxSteps: 3,
      maxPointSteps: 5,
    })).rejects.toThrow(/6 point-steps, exceeding maxPointSteps=5/);

    expect(getPoints).not.toHaveBeenCalled();
  });

  it("supports fields-only matrices and forwards de-duplicated fields", async () => {
    const getPoints = vi.fn(async (query: { analysisTime: string; fields?: string[]; points: typeof points }) => ({
      ...batch(new Date(query.analysisTime).toISOString()),
      selection: { fields: ["wind_10m" as const] },
      points: query.points.map((requestedPoint) => ({
        requestedPoint,
        gridPoint: {
          latitude: Math.round(requestedPoint.latitude * 2) / 2,
          longitude: Math.round(requestedPoint.longitude * 2) / 2,
        },
        fields: [{
          id: "wind_10m" as const,
          level: { type: "height_above_ground_m" as const, heightM: 10 },
          temporal: { type: "instantaneous" as const },
          values: { windSpeedMs: 5, windDirectionDeg: 220 },
        }],
        dataset: "archive.grb2",
        cacheHit: true,
      })),
    }));
    const service = new HistoricalPointsTimeSeriesService({
      pointsGetter: { getPoints } as never,
      now: () => new Date("2017-05-10T00:00:00Z"),
    });

    const result = await service.getPointsTimeSeries({
      points: [points[0]!],
      startTime: "2017-05-09T12:00:00Z",
      endTime: "2017-05-09T12:00:00Z",
      cycleHoursUtc: [12],
      fields: ["wind_10m", "wind_10m"],
      maxSteps: 1,
      maxPointSteps: 1,
    });

    expect(getPoints).toHaveBeenCalledWith(expect.objectContaining({ fields: ["wind_10m"] }));
    expect(result.selection).toEqual({ fields: ["wind_10m"], cycleHoursUtc: [12] });
    expect(result.series[0]?.points[0]?.fields?.[0]).toMatchObject({ id: "wind_10m" });
  });

  it("validates ranges, selections, and duplicate cycles at the schema boundary", () => {
    const base = {
      points: [points[0]],
      startTime: "2017-05-09T12:00:00Z",
      endTime: "2017-05-09T12:00:00Z",
      cycleHoursUtc: [12],
      maxSteps: 1,
      maxPointSteps: 1,
    };
    expect(historicalPointsTimeSeriesQuerySchema.safeParse({
      ...base,
      fields: ["wind_10m"],
    }).success).toBe(true);
    for (const invalid of [
      { ...base },
      { ...base, variables: ["temperature"] },
      { ...base, pressureLevelsHpa: [850] },
      { ...base, fields: ["wind_10m"], startTime: "2017-05-10T00:00:00Z", endTime: "2017-05-09T00:00:00Z" },
      { ...base, fields: ["wind_10m"], cycleHoursUtc: [12, 12] },
    ]) {
      expect(historicalPointsTimeSeriesQuerySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("rejects archive-range errors and maxSteps before point work", async () => {
    const getPoints = vi.fn();
    const service = new HistoricalPointsTimeSeriesService({
      pointsGetter: { getPoints } as never,
      now: () => new Date("2017-05-10T00:00:00Z"),
    });
    const selection = { variables: ["temperature" as const], pressureLevelsHpa: [850] };

    await expect(service.getPointsTimeSeries({
      points,
      startTime: "2006-12-31T18:00:00Z",
      endTime: "2006-12-31T18:00:00Z",
      cycleHoursUtc: [18],
      ...selection,
      maxSteps: 1,
      maxPointSteps: 2,
    })).rejects.toThrow(/history begins/);

    await expect(service.getPointsTimeSeries({
      points,
      startTime: "2017-05-10T06:00:00Z",
      endTime: "2017-05-10T06:00:00Z",
      cycleHoursUtc: [6],
      ...selection,
      maxSteps: 1,
      maxPointSteps: 2,
    })).rejects.toThrow(/must not be in the future/);

    await expect(service.getPointsTimeSeries({
      points,
      startTime: "2017-05-09T01:00:00Z",
      endTime: "2017-05-09T02:00:00Z",
      cycleHoursUtc: [12],
      ...selection,
      maxSteps: 1,
      maxPointSteps: 2,
    })).rejects.toThrow(/contains no selected GFS analysis cycles/);

    await expect(service.getPointsTimeSeries({
      points,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-09T12:00:00Z",
      cycleHoursUtc: [0, 6, 12],
      ...selection,
      maxSteps: 2,
      maxPointSteps: 6,
    })).rejects.toThrow(/exceeding maxSteps=2/);

    expect(getPoints).not.toHaveBeenCalled();
  });

  it("rejects time, point-count, order, and grid drift from point batches", async () => {
    const query = {
      points,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-09T06:00:00Z",
      cycleHoursUtc: [0, 6] as const,
      variables: ["temperature" as const],
      pressureLevelsHpa: [850],
      maxSteps: 2,
      maxPointSteps: 4,
    };

    let call = 0;
    await expect(new HistoricalPointsTimeSeriesService({
      pointsGetter: {
        getPoints: async ({ analysisTime }) => {
          call += 1;
          const value = batch(new Date(analysisTime).toISOString());
          return call === 2 ? { ...value, analysisTime: "2017-05-09T12:00:00.000Z" } : value;
        },
      },
      now: () => new Date("2017-05-10T00:00:00Z"),
    }).getPointsTimeSeries(query)).rejects.toThrow(/result time changed/);

    call = 0;
    await expect(new HistoricalPointsTimeSeriesService({
      pointsGetter: {
        getPoints: async ({ analysisTime }) => {
          call += 1;
          const value = batch(new Date(analysisTime).toISOString());
          return call === 2 ? { ...value, points: value.points.slice(0, 1) } : value;
        },
      },
      now: () => new Date("2017-05-10T00:00:00Z"),
    }).getPointsTimeSeries(query)).rejects.toThrow(/changed point count/);

    call = 0;
    await expect(new HistoricalPointsTimeSeriesService({
      pointsGetter: {
        getPoints: async ({ analysisTime }) => {
          call += 1;
          const value = batch(new Date(analysisTime).toISOString());
          return call === 2
            ? { ...value, points: value.points.map((point, index) => index === 0 ? { ...point, requestedPoint: { latitude: 1, longitude: 2 } } : point) }
            : value;
        },
      },
      now: () => new Date("2017-05-10T00:00:00Z"),
    }).getPointsTimeSeries(query)).rejects.toThrow(/changed input ordering/);

    call = 0;
    await expect(new HistoricalPointsTimeSeriesService({
      pointsGetter: {
        getPoints: async ({ analysisTime }) => {
          call += 1;
          const value = batch(new Date(analysisTime).toISOString());
          return call === 2
            ? { ...value, points: value.points.map((point, index) => index === 0 ? { ...point, gridPoint: { latitude: 40, longitude: 14.5 } } : point) }
            : value;
        },
      },
      now: () => new Date("2017-05-10T00:00:00Z"),
    }).getPointsTimeSeries(query)).rejects.toThrow(/grid point changed/);
  });

  it("participates in the shared atmospheric points-time-series dispatcher", async () => {
    const result = {
      model: "gfs_grid4_analysis_0p5" as const,
      requestedStartTime: "2017-05-09T00:00:00.000Z",
      requestedEndTime: "2017-05-09T00:00:00.000Z",
      selection: { variables: ["temperature" as const], pressureLevelsHpa: [850], cycleHoursUtc: [0 as const] },
      source: {
        provider: "NOAA NCEI" as const,
        access: "ncei_thredds_ncss" as const,
        composition: "serial_cycle_point_queries" as const,
      },
      series: [{ analysisTime: "2017-05-09T00:00:00.000Z", points: batch("2017-05-09T00:00:00.000Z").points }],
      caveat: "GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const,
    };
    const getPointsTimeSeries = vi.fn(async () => result);
    const service = new AtmosphericPointsTimeSeriesService({
      history: { getPointsTimeSeries },
      gfs: { getPointsTimeSeries: vi.fn() } as never,
      gefs: { getPointsTimeSeries: vi.fn() } as never,
    });

    const dispatched = await service.getPointsTimeSeries({
      model: "gfs_grid4_analysis_0p5",
      query: {
        points,
        startTime: result.requestedStartTime,
        endTime: result.requestedEndTime,
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        cycleHoursUtc: [0],
        maxSteps: 1,
        maxPointSteps: 2,
      },
    });

    expect(dispatched.model).toBe("gfs_grid4_analysis_0p5");
    expect(getPointsTimeSeries).toHaveBeenCalledOnce();
  });
});
