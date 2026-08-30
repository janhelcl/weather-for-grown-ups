import { describe, expect, it, vi } from "vitest";
import { GefsReforecastPointsTimeSeriesService } from "../src/core/gefs-reforecast-points-timeseries.js";

const run = new Date("2017-03-14T00:00:00Z");
const requestedPoints = [
  { latitude: 50.13, longitude: 14.37 },
  { latitude: 49.2, longitude: 16.61 },
];

function distribution(mean: number) {
  return {
    memberCount: 2,
    mean,
    populationStdDev: 0.5,
    min: mean - 0.5,
    max: mean + 0.5,
    quantiles: [{ quantile: 0.5, value: mean }],
  };
}

function gridPoint(
  point: { latitude: number; longitude: number },
  forecastHour: number,
) {
  const factor = forecastHour <= 240 ? 4 : 2;
  return {
    latitude: Math.round(point.latitude * factor) / factor,
    longitude: Math.round(point.longitude * factor) / factor,
  };
}

function fieldBatch(validTime: string) {
  const time = new Date(validTime);
  const forecastHour = (time.getTime() - run.getTime()) / 3_600_000;
  const early = forecastHour <= 240;
  return {
    model: "gefs_v12_reforecast" as const,
    kind: "fields" as const,
    run: run.toISOString(),
    validTime: time.toISOString(),
    forecastHour,
    selection: {
      kind: "fields" as const,
      fields: ["temperature_2m" as const],
      members: ["c00" as const, "p01" as const],
      quantiles: [0.5],
    },
    includeMembers: false,
    points: requestedPoints.map((point) => ({
      kind: "fields" as const,
      requestedPoint: point,
      gridPoint: gridPoint(point, forecastHour),
      fieldSummaries: [{
        field: "temperature_2m" as const,
        level: {
          gribLevel: "2 m above ground",
          description: "2 m above ground",
        },
        temporal: { type: "instantaneous" as const },
        outputs: [{
          aggregation: "numeric_distribution" as const,
          field: "temperatureC",
          unit: "degC",
          distribution: distribution(10 + forecastHour / 24),
        }],
      }],
    })),
    source: {
      provider: "NOAA AWS Open Data" as const,
      access: "s3_range" as const,
      decoder: "wgrib2" as const,
      archiveType: "reforecast" as const,
      dataset: "GEFSv12/reforecast" as const,
      leadBlock: early ? "Days:1-10" as const : "Days:10-16" as const,
      horizontalGridDegrees: early ? 0.25 as const : 0.5 as const,
      allCacheHit: forecastHour !== 246,
    },
  };
}

function profileBatch(validTime: string) {
  const time = new Date(validTime);
  const forecastHour = (time.getTime() - run.getTime()) / 3_600_000;
  return {
    model: "gefs_v12_reforecast" as const,
    kind: "profile" as const,
    run: run.toISOString(),
    validTime: time.toISOString(),
    forecastHour,
    selection: {
      kind: "profile" as const,
      variables: ["temperature" as const],
      pressureLevelsHpa: [850, 500],
      members: ["c00" as const, "p01" as const],
      quantiles: [0.5],
    },
    includeMembers: false,
    points: requestedPoints.map((point) => ({
      kind: "profile" as const,
      requestedPoint: point,
      gridPoint: {
        latitude: Math.round(point.latitude * 2) / 2,
        longitude: Math.round(point.longitude * 2) / 2,
      },
      summaries: [850, 500].map((pressureLevelHpa) => ({
        variable: "temperature" as const,
        gfsCode: "TMP",
        pressureLevelHpa,
        outputField: "temperatureC",
        unit: "degC",
        ...distribution(pressureLevelHpa === 850 ? 8 : -15),
      })),
    })),
    source: {
      provider: "NOAA AWS Open Data" as const,
      access: "s3_range" as const,
      decoder: "gribberish" as const,
      archiveType: "reforecast" as const,
      dataset: "GEFSv12/reforecast" as const,
      leadBlock: "Days:1-10" as const,
      horizontalGridDegrees: 0.5 as const,
      profileGridPolicy: "coherent_0p50" as const,
      allCacheHit: true,
    },
  };
}

describe("GEFSv12 reforecast multi-point ranges", () => {
  it("preserves per-step point grids across the f240 transition", async () => {
    const getPoints = vi.fn(async (query: any) => fieldBatch(query.validTime));
    const service = new GefsReforecastPointsTimeSeriesService({
      pointsGetter: { getPoints } as any,
      stepConcurrency: 2,
    });

    const result = await service.getPointsTimeSeries({
      points: requestedPoints,
      run: run.toISOString(),
      startTime: "2017-03-23T21:00:00Z",
      endTime: "2017-03-24T06:00:00Z",
      selection: { kind: "fields", fields: ["temperature_2m"] },
      members: ["p01", "c00"],
      quantiles: [0.5],
      maxSteps: 3,
      maxPointSteps: 6,
    });

    expect(result.selection).toMatchObject({
      kind: "fields",
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    });
    expect(result.series.map((step) => step.forecastHour))
      .toEqual([237, 240, 246]);
    expect(result.series.map((step) => step.source.horizontalGridDegrees))
      .toEqual([0.25, 0.25, 0.5]);
    expect(result.series[0]?.points.map((point) => point.gridPoint)).toEqual([
      { latitude: 50.25, longitude: 14.25 },
      { latitude: 49.25, longitude: 16.5 },
    ]);
    expect(result.series[2]?.points.map((point) => point.gridPoint)).toEqual([
      { latitude: 50, longitude: 14.5 },
      { latitude: 49, longitude: 16.5 },
    ]);
    expect(result.source.nativeCadence).toEqual([
      { fromForecastHour: 3, throughForecastHour: 240, stepHours: 3 },
      { fromForecastHour: 246, throughForecastHour: 384, stepHours: 6 },
    ]);
    expect(result.source.allCacheHit).toBe(false);
    expect(getPoints).toHaveBeenCalledTimes(3);
    expect(getPoints.mock.calls.every((call) => call[0].includeMembers === false)).toBe(true);
  });

  it("keeps profile grid policy on every point-time batch", async () => {
    const getPoints = vi.fn(async (query: any) => profileBatch(query.validTime));
    const service = new GefsReforecastPointsTimeSeriesService({
      pointsGetter: { getPoints } as any,
      stepConcurrency: 1,
    });

    const result = await service.getPointsTimeSeries({
      points: requestedPoints,
      run: run.toISOString(),
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      selection: {
        kind: "profile",
        variables: ["temperature"],
        pressureLevelsHpa: [500, 850],
      },
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxPointSteps: 4,
    });

    expect(result.selection).toMatchObject({
      kind: "profile",
      pressureLevelsHpa: [850, 500],
    });
    expect(result.series).toHaveLength(2);
    expect(result.series.every((step) =>
      step.kind === "profile"
      && step.source.profileGridPolicy === "coherent_0p50")).toBe(true);
    expect(result.source).toMatchObject({
      decoder: "gribberish",
      allCacheHit: true,
    });
  });

  it("rejects oversized point-step matrices before point work starts", async () => {
    const getPoints = vi.fn();
    const service = new GefsReforecastPointsTimeSeriesService({
      pointsGetter: { getPoints } as any,
    });

    await expect(service.getPointsTimeSeries({
      points: requestedPoints,
      run: run.toISOString(),
      startTime: "2017-03-23T21:00:00Z",
      endTime: "2017-03-24T06:00:00Z",
      selection: { kind: "fields", fields: ["temperature_2m"] },
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxSteps: 3,
      maxPointSteps: 5,
    })).rejects.toThrow("2 points × 3 steps = 6 point-steps");
    expect(getPoints).not.toHaveBeenCalled();
  });

  it("constructs default collaborators without eager upstream access", () => {
    expect(() => new GefsReforecastPointsTimeSeriesService()).not.toThrow();
  });
});
