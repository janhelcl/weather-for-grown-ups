import { describe, expect, it, vi } from "vitest";
import { HgefsForecastService } from "../src/core/hgefs.js";
import {
  diagnoseAtmosphereSchema,
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";

const run = "2026-08-31T00:00:00.000Z";
const validTime = "2026-08-31T06:00:00.000Z";
const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };
const gefsGrid = { latitude: 50, longitude: 14 };
const aigefsGrid = { latitude: 50, longitude: 14.5 };

function hourFor(validTime: string): number {
  return (new Date(validTime).getTime() - new Date(run).getTime()) / 3_600_000;
}

function pressureLevel(member: string, value: number) {
  return {
    member,
    cacheHit: true,
    pressureValues: [{
      variable: "temperature",
      pressureLevelHpa: 850,
      value,
    }],
    fields: [],
  };
}

function aiLevel(member: string, value: number) {
  return {
    member,
    cacheHit: true,
    levels: [{ pressureHpa: 850, temperatureC: value }],
  };
}

describe("HGEFS composed query operations", () => {
  it("builds a compact native-cadence point range and folds cache provenance across steps", async () => {
    const aigefsQuery = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime: request.time.at,
      forecastHour: hourFor(request.time.at),
      requestedPoint: point,
      gridPoint: aigefsGrid,
      members: request.ensemble.members.map((member: string) =>
        aiLevel(member, member === "c00" ? hourFor(request.time.at) : 99)),
      source: { allCacheHit: true },
    }));
    const gefsQuery = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime: request.time.at,
      forecastHour: hourFor(request.time.at),
      requestedPoint: point,
      gridPoint: gefsGrid,
      members: request.ensemble.members.map((member: string) =>
        pressureLevel(member, member === "c00" ? hourFor(request.time.at) + 2 : 88)),
      source: { allCacheHit: request.time.at.endsWith("06:00:00.000Z") },
    }));

    const service = new HgefsForecastService({
      aigefs: { query: aigefsQuery, diagnose: vi.fn() } as any,
      gefsQuery: { query: gefsQuery },
      gefsDiagnostics: { diagnose: vi.fn() },
      stepConcurrency: 1,
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: {
        from: "2026-08-31T06:00:00.000Z",
        to: "2026-08-31T12:00:00.000Z",
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run },
      ensemble: {
        members: ["gefs:c00", "aigefs:c00"],
        quantiles: [0.5],
      },
    })) as any;

    expect(result.series).toHaveLength(2);
    expect(result.series.map((step: any) => step.forecastHour)).toEqual([6, 12]);
    expect(result.series.map((step: any) =>
      step.pressureSummaries[0].distribution.mean)).toEqual([7, 13]);
    expect(result.series.every((step: any) => step.members === undefined)).toBe(true);
    expect(result.source.allCacheHit).toBe(false);
    expect(aigefsQuery).toHaveBeenCalledTimes(2);
    expect(gefsQuery).toHaveBeenCalledTimes(2);
  });

  it("composes multi-point member payloads from both populations", async () => {
    const points = [
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 49.2, longitude: 16.61 },
    ];
    const selectedAi = ["c00", "p01"];
    const selectedGefs = ["c00", "p01"];

    const aigefsQuery = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime: request.time.at,
      forecastHour: 6,
      members: selectedAi.map((member, memberIndex) => ({
        member,
        cacheHit: true,
        points: points.map((requestedPoint, pointIndex) => ({
          requestedPoint,
          gridPoint: {
            latitude: aigefsGrid.latitude - pointIndex,
            longitude: aigefsGrid.longitude + pointIndex,
          },
          levels: [{
            pressureHpa: 850,
            temperatureC: 10 + memberIndex + pointIndex,
          }],
        })),
      })),
      source: { cacheHit: true },
    }));
    const gefsQuery = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime: request.time.at,
      forecastHour: 6,
      points: points.map((requestedPoint, pointIndex) => ({
        requestedPoint,
        gridPoint: {
          latitude: gefsGrid.latitude - pointIndex,
          longitude: gefsGrid.longitude + pointIndex,
        },
        members: selectedGefs.map((member, memberIndex) => ({
          member,
          cacheHit: true,
          pressureValues: [{
            variable: "temperature",
            pressureLevelHpa: 850,
            value: 12 + memberIndex + pointIndex,
          }],
          fields: [],
        })),
      })),
      source: {},
    }));

    const service = new HgefsForecastService({
      aigefs: { query: aigefsQuery, diagnose: vi.fn() } as any,
      gefsQuery: { query: gefsQuery },
      gefsDiagnostics: { diagnose: vi.fn() },
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "points", points },
      time: { at: "2026-08-31T06:00:00.000Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run },
      ensemble: {
        members: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
        quantiles: [0.5],
        includeMembers: true,
      },
    })) as any;

    expect(result.points).toHaveLength(2);
    expect(result.points[0].members.map((member: any) => member.member)).toEqual([
      "gefs:c00",
      "gefs:p01",
      "aigefs:c00",
      "aigefs:p01",
    ]);
    expect(result.points[1].pressureSummaries[0].distribution.memberCount).toBe(4);
    expect(result.source.allCacheHit).toBe(false);
  });

  it("composes a member-first transect without flattening constituent grids", async () => {
    const samples = [
      {
        index: 0,
        fraction: 0,
        distanceKm: 0,
        requestedPoint: { latitude: 50, longitude: 14 },
      },
      {
        index: 1,
        fraction: 1,
        distanceKm: 100,
        requestedPoint: { latitude: 49.5, longitude: 15 },
      },
    ];

    const aigefsQuery = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime: request.time.at,
      forecastHour: 6,
      totalDistanceKm: 100,
      samples: samples.map((sample, index) => ({
        ...sample,
        gridPoint: {
          latitude: aigefsGrid.latitude - index,
          longitude: aigefsGrid.longitude + index,
        },
      })),
      members: request.ensemble.members.map((member: string, memberIndex: number) => ({
        member,
        samples: samples.map((sample, index) => ({
          ...sample,
          gridPoint: {
            latitude: aigefsGrid.latitude - index,
            longitude: aigefsGrid.longitude + index,
          },
          levels: [{
            pressureHpa: 850,
            temperatureC: 10 + memberIndex + index,
          }],
        })),
      })),
      source: { allCacheHit: true },
    }));
    const gefsQuery = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime: request.time.at,
      forecastHour: 6,
      totalDistanceKm: 100,
      samples: samples.map((sample, index) => ({
        ...sample,
        gridPoint: {
          latitude: gefsGrid.latitude - index,
          longitude: gefsGrid.longitude + index,
        },
        members: request.ensemble.members.map((member: string, memberIndex: number) => ({
          member,
          cacheHit: true,
          pressureValues: [{
            variable: "temperature",
            pressureLevelHpa: 850,
            value: 12 + memberIndex + index,
          }],
          fields: [],
        })),
      })),
      source: { allCacheHit: true },
    }));

    const service = new HgefsForecastService({
      aigefs: { query: aigefsQuery, diagnose: vi.fn() } as any,
      gefsQuery: { query: gefsQuery },
      gefsDiagnostics: { diagnose: vi.fn() },
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: {
        type: "transect",
        start: { latitude: 50, longitude: 14 },
        end: { latitude: 49.5, longitude: 15 },
        samples: 2,
      },
      time: { at: "2026-08-31T06:00:00.000Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run },
      ensemble: {
        members: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
        quantiles: [0.5],
      },
    })) as any;

    expect(result.totalDistanceKm).toBe(100);
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0].constituentGridPoints).toHaveLength(2);
    expect(result.samples[1].pressureSummaries[0].distribution.memberCount).toBe(4);
  });

  it("pools rich member area statistics and resolves latest against surface-only inventory", async () => {
    const runProvider = {
      resolveLatestRun: vi.fn(async () => new Date(run)),
    };
    const percentile = (value: number) => [{ percentile: 50, value }];
    const threshold = (fraction: number) => [{
      operator: "gte" as const,
      threshold: 10,
      matchingGridPoints: Math.round(fraction * 10),
      fraction,
    }];
    const extrema = (value: number) => ({
      min: { value, latitude: 49, longitude: 14 },
      max: { value: value + 4, latitude: 50, longitude: 15 },
    });

    const aigefsQuery = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime: request.time.at,
      forecastHour: 6,
      members: request.ensemble.members.map((member: string, index: number) => ({
        member,
        cacheHit: true,
        statistics: {
          definedGridPoints: 10,
          mean: 11 + index,
          min: 8 + index,
          max: 14 + index,
        },
        distribution: {
          percentiles: percentile(11 + index),
          thresholdFractions: threshold(0.6 + index * 0.1),
          extrema: extrema(8 + index),
        },
      })),
      source: { allCacheHit: true },
    }));
    const gefsQuery = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime: request.time.at,
      forecastHour: 6,
      members: request.ensemble.members.map((member: string, index: number) => ({
        member,
        cacheHit: true,
        statistics: {
          definedGridPoints: 6,
          mean: 9 + index,
          min: 6 + index,
          max: 12 + index,
        },
        percentiles: percentile(9 + index),
        thresholdFractions: threshold(0.4 + index * 0.1),
        extrema: extrema(6 + index),
      })),
      source: { allCacheHit: true },
    }));

    const service = new HgefsForecastService({
      runProvider: runProvider as any,
      aigefs: { query: aigefsQuery, diagnose: vi.fn() } as any,
      gefsQuery: { query: gefsQuery },
      gefsDiagnostics: { diagnose: vi.fn() },
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: {
        type: "area",
        westLongitude: 13.5,
        eastLongitude: 15,
        southLatitude: 49.5,
        northLatitude: 50.5,
      },
      time: { at: "2026-08-31T06:00:00.000Z" },
      selection: { fields: ["temperature_2m"] },
      forecast: { run: "latest" },
      ensemble: {
        members: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
        quantiles: [0.5],
        includeMembers: true,
      },
      aggregate: {
        percentiles: [50],
        thresholds: [{ operator: "gte", value: 10 }],
        includeExtremaLocations: true,
      },
    })) as any;

    expect(runProvider.resolveLatestRun).toHaveBeenCalledWith(expect.objectContaining({
      type: "valid_time",
      products: { pressure: false, surface: true },
    }));
    expect(result.statistics.mean.memberCount).toBe(4);
    expect(result.definedGridPointsByPopulation).toHaveLength(2);
    expect(result.spatialPercentiles[0].distribution.memberCount).toBe(4);
    expect(result.spatialThresholdFractions[0].distribution.memberCount).toBe(4);
    expect(result.memberExtrema).toHaveLength(4);
    expect(result.members).toHaveLength(4);
  });

  it("aggregates derived surface wind fields, including circular direction", async () => {
    const temporal = { type: "instantaneous" as const };
    const level = { type: "height_above_ground_m" as const, heightM: 10 };
    const aigefsQuery = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime: request.time.at,
      forecastHour: 6,
      requestedPoint: point,
      gridPoint: aigefsGrid,
      members: request.ensemble.members.map((member: string) => ({
        member,
        cacheHit: true,
        levels: [],
        fields: [{
          id: "wind_10m",
          level,
          temporal,
          values: {
            windSpeedMs: member === "c00" ? 5 : 99,
            windDirectionDeg: member === "c00" ? 350 : 90,
          },
        }],
      })),
      source: { allCacheHit: true },
    }));
    const gefsQuery = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime: request.time.at,
      forecastHour: 6,
      requestedPoint: point,
      gridPoint: gefsGrid,
      members: request.ensemble.members.map((member: string) => ({
        member,
        cacheHit: true,
        pressureValues: [],
        fields: [{
          field: "wind_10m",
          temporal,
          values: {
            windSpeedMs: member === "c00" ? 7 : 88,
            windDirectionDeg: member === "c00" ? 10 : 180,
          },
        }],
      })),
      source: { allCacheHit: true },
    }));

    const service = new HgefsForecastService({
      aigefs: { query: aigefsQuery, diagnose: vi.fn() } as any,
      gefsQuery: { query: gefsQuery },
      gefsDiagnostics: { diagnose: vi.fn() },
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: { at: "2026-08-31T06:00:00.000Z" },
      selection: { fields: ["wind_10m"] },
      forecast: { run },
      ensemble: {
        members: ["gefs:c00", "aigefs:c00"],
        quantiles: [0.5],
      },
    })) as any;

    const outputs = result.fieldSummaries[0].outputs;
    expect(outputs.find((output: any) => output.field === "windSpeedMs").distribution.mean).toBe(6);
    expect(outputs.find((output: any) => output.field === "windDirectionDeg")).toMatchObject({
      aggregation: "circular_direction",
      memberCount: 2,
    });
  });
});

describe("HGEFS diagnostic ranges", () => {
  it("summarizes profile diagnostics through native time while suppressing raw member series", async () => {
    const diagResult = (
      model: string,
      gridPoint: { latitude: number; longitude: number },
      request: any,
      offset: number,
    ) => ({
      model,
      run,
      validTime: request.time.at,
      forecastHour: hourFor(request.time.at),
      requestedPoint: point,
      gridPoint,
      sampledPressureLevelsHpa: [850, 700],
      members: request.ensemble.members.map((member: string, index: number) => ({
        member,
        cacheHit: true,
        levels: [
          { pressureHpa: 850, temperatureC: 0 },
          { pressureHpa: 700, temperatureC: -5 },
        ],
        diagnostics: [{
          id: "freezing_level_crossings",
          crossings: [{
            geopotentialHeightGpm: 1500 + offset + index * 100,
            pressureHpa: 850 - index * 10,
          }],
        }],
      })),
      source: { allCacheHit: true },
    });

    const aigefsDiagnose = vi.fn(async (request: any) =>
      diagResult("aigefs_0p25", aigefsGrid, request, 200));
    const gefsDiagnose = vi.fn(async (request: any) =>
      diagResult("gefs_0p50", gefsGrid, request, 0));

    const service = new HgefsForecastService({
      aigefs: { query: vi.fn(), diagnose: aigefsDiagnose } as any,
      gefsQuery: { query: vi.fn() },
      gefsDiagnostics: { diagnose: gefsDiagnose },
      stepConcurrency: 1,
    });

    const result = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: {
        from: "2026-08-31T06:00:00.000Z",
        to: "2026-08-31T12:00:00.000Z",
      },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700],
        diagnostics: ["freezing_level_crossings"],
      },
      forecast: { run },
      ensemble: {
        members: ["gefs:c00", "aigefs:c00"],
        quantiles: [0.5],
      },
    })) as any;

    expect(result.series).toHaveLength(2);
    expect(result.series.every((step: any) => step.kind === "profile")).toBe(true);
    expect(result.series.every((step: any) => step.members === undefined)).toBe(true);
    expect(result.series[0].summaries[0].membersWithAnyCrossing).toMatchObject({
      count: 2,
      memberCount: 2,
      fraction: 1,
    });
    expect(aigefsDiagnose).toHaveBeenCalledTimes(2);
    expect(gefsDiagnose).toHaveBeenCalledTimes(2);
  });
});


describe("HGEFS additional compact branches", () => {
  it("returns compact multi-point ranges across native steps", async () => {
    const points = [
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 49.2, longitude: 16.61 },
    ];
    const fh = (time: string) =>
      (new Date(time).getTime() - new Date(run).getTime()) / 3_600_000;

    const aigefsQuery = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime: request.time.at,
      forecastHour: fh(request.time.at),
      members: request.ensemble.members.map((member: string) => ({
        member,
        cacheHit: true,
        points: points.map((requestedPoint, index) => ({
          requestedPoint,
          gridPoint: { latitude: 50 - index, longitude: 14.5 + index },
          levels: [{ pressureHpa: 850, temperatureC: fh(request.time.at) + index }],
        })),
      })),
      source: { allCacheHit: true },
    }));
    const gefsQuery = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime: request.time.at,
      forecastHour: fh(request.time.at),
      points: points.map((requestedPoint, index) => ({
        requestedPoint,
        gridPoint: { latitude: 50 - index, longitude: 14 + index },
        members: request.ensemble.members.map((member: string) => ({
          member,
          cacheHit: true,
          pressureValues: [{
            variable: "temperature",
            pressureLevelHpa: 850,
            value: fh(request.time.at) + index + 2,
          }],
          fields: [],
        })),
      })),
      source: { allCacheHit: true },
    }));

    const service = new HgefsForecastService({
      aigefs: { query: aigefsQuery, diagnose: vi.fn() } as any,
      gefsQuery: { query: gefsQuery },
      gefsDiagnostics: { diagnose: vi.fn() },
      stepConcurrency: 1,
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "points", points },
      time: {
        from: "2026-08-31T06:00:00.000Z",
        to: "2026-08-31T12:00:00.000Z",
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run },
      ensemble: {
        members: ["gefs:c00", "aigefs:c00"],
        quantiles: [0.5],
      },
    })) as any;

    expect(result.series).toHaveLength(2);
    expect(result.series[0].points).toHaveLength(2);
    expect(result.series[1].points[1].pressureSummaries[0].distribution.mean).toBe(14);
  });

  it("returns a minimal AIGEFS-only area result without optional rich outputs", async () => {
    const aigefsQuery = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime,
      forecastHour: 6,
      members: request.ensemble.members.map((member: string, index: number) => ({
        member,
        cacheHit: true,
        statistics: {
          definedGridPoints: 12,
          mean: 10 + index,
          min: 7 + index,
          max: 13 + index,
        },
      })),
      source: { allCacheHit: true },
    }));
    const gefsQuery = vi.fn();

    const service = new HgefsForecastService({
      aigefs: { query: aigefsQuery, diagnose: vi.fn() } as any,
      gefsQuery: { query: gefsQuery },
      gefsDiagnostics: { diagnose: vi.fn() },
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: {
        type: "area",
        westLongitude: 13.5,
        eastLongitude: 15,
        southLatitude: 49.5,
        northLatitude: 50.5,
      },
      time: { at: validTime },
      selection: { fields: ["temperature_2m"] },
      forecast: { run },
      ensemble: {
        members: ["aigefs:c00", "aigefs:p01"],
        quantiles: [0.5],
      },
    })) as any;

    expect(gefsQuery).not.toHaveBeenCalled();
    expect(result.definedGridPointsByPopulation).toHaveLength(1);
    expect(result.spatialPercentiles).toBeUndefined();
    expect(result.spatialThresholdFractions).toBeUndefined();
    expect(result.memberExtrema).toBeUndefined();
    expect(result.members).toBeUndefined();
  });
});


describe("HGEFS AI-only diagnostics", () => {
  it("summarizes an AIGEFS-only profile diagnostic on one constituent grid", async () => {
    const aigefsDiagnose = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime,
      forecastHour: 6,
      gridPoint: aigefsGrid,
      sampledPressureLevelsHpa: [850, 700],
      members: request.ensemble.members.map((member: string, index: number) => ({
        member,
        cacheHit: true,
        levels: [
          { pressureHpa: 850, temperatureC: 1 },
          { pressureHpa: 700, temperatureC: -4 },
        ],
        diagnostics: [{
          id: "freezing_level_crossings",
          crossings: index === 0
            ? [{ geopotentialHeightGpm: 1600, pressureHpa: 820 }]
            : [],
        }],
      })),
      source: { cacheHit: true },
    }));
    const gefsDiagnose = vi.fn();

    const service = new HgefsForecastService({
      aigefs: { query: vi.fn(), diagnose: aigefsDiagnose } as any,
      gefsQuery: { query: vi.fn() },
      gefsDiagnostics: { diagnose: gefsDiagnose },
    });

    const result = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: { at: validTime },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700],
        diagnostics: ["freezing_level_crossings"],
      },
      forecast: { run },
      ensemble: {
        members: ["aigefs:c00", "aigefs:p01"],
        quantiles: [0.5],
      },
    })) as any;

    expect(gefsDiagnose).not.toHaveBeenCalled();
    expect(result.constituentGridPoints).toEqual([{
      population: "aigefs",
      modelClass: "ai",
      gridPoint: aigefsGrid,
    }]);
    expect(result.summaries[0].membersWithAnyCrossing).toMatchObject({
      count: 1,
      memberCount: 2,
      fraction: 0.5,
    });
    expect(result.members).toBeUndefined();
    expect(result.source.allCacheHit).toBe(true);
  });
});
