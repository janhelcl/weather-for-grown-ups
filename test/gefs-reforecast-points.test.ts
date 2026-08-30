import { describe, expect, it, vi } from "vitest";
import { GefsReforecastPointsService } from "../src/core/gefs-reforecast-points.js";

const run = "2017-03-14T00:00:00.000Z";
const validTime = "2017-03-14T12:00:00.000Z";

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

function fieldResult(point: { latitude: number; longitude: number }, cacheHit: boolean) {
  return {
    model: "gefs_v12_reforecast" as const,
    run,
    validTime,
    forecastHour: 12,
    requestedPoint: point,
    gridPoint: point,
    selection: {
      fields: ["temperature_2m" as const],
      members: ["c00" as const, "p01" as const],
      quantiles: [0.5],
    },
    fieldSummaries: [{
      field: "temperature_2m" as const,
      level: { gribLevel: "2 m above ground", description: "2 m above ground" },
      temporal: { type: "instantaneous" as const },
      outputs: [{
        aggregation: "numeric_distribution" as const,
        field: "temperatureC",
        unit: "degC",
        distribution: distribution(10),
      }],
    }],
    source: {
      provider: "NOAA AWS Open Data" as const,
      access: "s3_range" as const,
      decoder: "wgrib2" as const,
      archiveType: "reforecast" as const,
      dataset: "GEFSv12/reforecast" as const,
      leadBlock: "Days:1-10" as const,
      horizontalGridDegrees: 0.25 as const,
      allCacheHit: cacheHit,
    },
  };
}

function profileResult(point: { latitude: number; longitude: number }) {
  return {
    model: "gefs_v12_reforecast" as const,
    run,
    validTime,
    forecastHour: 12,
    requestedPoint: point,
    gridPoint: {
      latitude: Math.round(point.latitude * 2) / 2,
      longitude: Math.round(point.longitude * 2) / 2,
    },
    selection: {
      variables: ["temperature" as const],
      pressureLevelsHpa: [850, 500],
      members: ["c00" as const, "p01" as const],
      quantiles: [0.5],
    },
    summaries: [850, 500].map((pressureLevelHpa) => ({
      variable: "temperature" as const,
      gfsCode: "TMP",
      pressureLevelHpa,
      outputField: "temperatureC",
      unit: "degC",
      ...distribution(pressureLevelHpa === 850 ? 8 : -15),
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

describe("GEFSv12 reforecast multi-point service", () => {
  it("preserves requested point order and aggregates common field provenance", async () => {
    const points = [
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 49.2, longitude: 16.61 },
    ];
    let call = 0;
    const getPoint = vi.fn(async (query: any) => {
      const result = fieldResult(
        { latitude: query.latitude, longitude: query.longitude },
        call > 0,
      );
      call += 1;
      return result;
    });
    const service = new GefsReforecastPointsService({
      pointGetter: { getPoint } as any,
      profileGetter: { getProfile: vi.fn() } as any,
      pointConcurrency: 1,
    });

    const result = await service.getPoints({
      points,
      run,
      validTime,
      selection: { kind: "fields", fields: ["temperature_2m"] },
      members: ["p01", "c00"],
      quantiles: [0.5],
    });

    expect(result).toMatchObject({
      model: "gefs_v12_reforecast",
      kind: "fields",
      forecastHour: 12,
      includeMembers: false,
      selection: {
        kind: "fields",
        fields: ["temperature_2m"],
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
      source: {
        decoder: "wgrib2",
        horizontalGridDegrees: 0.25,
        allCacheHit: false,
      },
    });
    expect(result.points.map((point) => point.requestedPoint)).toEqual(points);
    expect(getPoint).toHaveBeenCalledTimes(2);
    expect(getPoint.mock.calls[0]?.[0]).toMatchObject({
      members: ["c00", "p01"],
      includeMembers: false,
    });
  });

  it("preserves coherent profile-grid policy across multiple coordinates", async () => {
    const points = [
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 48.15, longitude: 17.11 },
    ];
    const getProfile = vi.fn(async (query: any) =>
      profileResult({ latitude: query.latitude, longitude: query.longitude }));
    const service = new GefsReforecastPointsService({
      pointGetter: { getPoint: vi.fn() } as any,
      profileGetter: { getProfile } as any,
      pointConcurrency: 2,
    });

    const result = await service.getPoints({
      points,
      run,
      validTime,
      selection: {
        kind: "profile",
        variables: ["temperature"],
        pressureLevelsHpa: [500, 850],
      },
      members: ["c00", "p01"],
      quantiles: [0.5],
    });

    expect(result).toMatchObject({
      kind: "profile",
      selection: {
        kind: "profile",
        variables: ["temperature"],
        pressureLevelsHpa: [850, 500],
      },
      source: {
        decoder: "gribberish",
        horizontalGridDegrees: 0.5,
        profileGridPolicy: "coherent_0p50",
        allCacheHit: true,
      },
    });
    expect(result.points).toHaveLength(2);
    expect(getProfile).toHaveBeenCalledTimes(2);
  });

  it("guards raw member payload size before point work begins", async () => {
    const getPoint = vi.fn();
    const service = new GefsReforecastPointsService({
      pointGetter: { getPoint } as any,
      profileGetter: { getProfile: vi.fn() } as any,
    });

    await expect(service.getPoints({
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.2, longitude: 16.61 },
      ],
      run,
      validTime,
      selection: { kind: "fields", fields: ["temperature_2m"] },
      members: ["c00", "p01"],
      quantiles: [0.5],
      includeMembers: true,
      maxMemberSamples: 3,
    })).rejects.toThrow("exceeding maxMemberSamples=3");
    expect(getPoint).not.toHaveBeenCalled();
  });

  it("rejects source-semantics drift between points", async () => {
    let call = 0;
    const getPoint = vi.fn(async (query: any) => {
      const result = fieldResult(
        { latitude: query.latitude, longitude: query.longitude },
        true,
      );
      call += 1;
      return call === 1
        ? result
        : {
            ...result,
            source: {
              ...result.source,
              decoder: "gribberish" as const,
            },
          };
    });
    const service = new GefsReforecastPointsService({
      pointGetter: { getPoint } as any,
      profileGetter: { getProfile: vi.fn() } as any,
      pointConcurrency: 1,
    });

    await expect(service.getPoints({
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.2, longitude: 16.61 },
      ],
      run,
      validTime,
      selection: { kind: "fields", fields: ["temperature_2m"] },
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("changed source semantics between points");
  });

  it("constructs default collaborators without eager upstream access", () => {
    expect(() => new GefsReforecastPointsService()).not.toThrow();
  });
});
