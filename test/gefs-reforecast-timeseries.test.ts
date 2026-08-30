import { describe, expect, it, vi } from "vitest";
import { GefsReforecastTimeSeriesService } from "../src/core/gefs-reforecast-timeseries.js";

const run = new Date("2017-03-14T00:00:00Z");

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

describe("GEFSv12 reforecast time ranges", () => {
  it("preserves per-step grid provenance across the f240 transition", async () => {
    const getPoint = vi.fn(async (query: any) => {
      const validTime = new Date(query.validTime);
      const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
      const early = forecastHour <= 240;
      return {
        model: "gefs_v12_reforecast",
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        forecastHour,
        gridPoint: early
          ? { latitude: 50.25, longitude: 14.25 }
          : { latitude: 50, longitude: 14.5 },
        fieldSummaries: [{
          field: "temperature_2m",
          level: { gribLevel: "2 m above ground", description: "2 m above ground" },
          temporal: { type: "instantaneous" },
          outputs: [{
            aggregation: "numeric_distribution",
            field: "temperatureC",
            unit: "degC",
            distribution: distribution(10 + forecastHour / 24),
          }],
        }],
        source: {
          decoder: "wgrib2" as const,
          leadBlock: early ? "Days:1-10" as const : "Days:10-16" as const,
          horizontalGridDegrees: early ? 0.25 as const : 0.5 as const,
          allCacheHit: forecastHour !== 246,
        },
      };
    });
    const service = new GefsReforecastTimeSeriesService({
      pointGetter: { getPoint } as any,
      profileGetter: { getProfile: vi.fn() } as any,
      stepConcurrency: 2,
    });

    const result = await service.getTimeSeries({
      latitude: 50.13,
      longitude: 14.37,
      run: run.toISOString(),
      startTime: "2017-03-23T21:00:00Z",
      endTime: "2017-03-24T12:00:00Z",
      selection: { kind: "fields", fields: ["temperature_2m"] },
      members: ["p01", "c00"],
      quantiles: [0.5],
      maxSteps: 4,
    });

    expect(result.selection).toMatchObject({
      kind: "fields",
      members: ["c00", "p01"],
      quantiles: [0.5],
    });
    expect(result.series.map((step) => step.forecastHour))
      .toEqual([237, 240, 246, 252]);
    expect(result.series.map((step) => step.source.horizontalGridDegrees))
      .toEqual([0.25, 0.25, 0.5, 0.5]);
    expect(result.series.map((step) => step.gridPoint)).toEqual([
      { latitude: 50.25, longitude: 14.25 },
      { latitude: 50.25, longitude: 14.25 },
      { latitude: 50, longitude: 14.5 },
      { latitude: 50, longitude: 14.5 },
    ]);
    expect(result.source.nativeCadence).toEqual([
      { fromForecastHour: 3, throughForecastHour: 240, stepHours: 3 },
      { fromForecastHour: 246, throughForecastHour: 384, stepHours: 6 },
    ]);
    expect(result.source.allCacheHit).toBe(false);
    expect(getPoint).toHaveBeenCalledTimes(4);
    expect(getPoint.mock.calls.every((call) => call[0].includeMembers === false)).toBe(true);
  });

  it("reuses the profile service and keeps profile grid policy per step", async () => {
    const getProfile = vi.fn(async (query: any) => {
      const validTime = new Date(query.validTime);
      const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
      return {
        model: "gefs_v12_reforecast",
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        forecastHour,
        gridPoint: { latitude: 50, longitude: 14.5 },
        summaries: [{
          variable: "temperature",
          gfsCode: "TMP",
          pressureLevelHpa: 850,
          outputField: "temperatureC",
          unit: "degC",
          ...distribution(8 + forecastHour),
        }, {
          variable: "temperature",
          gfsCode: "TMP",
          pressureLevelHpa: 500,
          outputField: "temperatureC",
          unit: "degC",
          ...distribution(-15 + forecastHour),
        }],
        source: {
          decoder: "gribberish" as const,
          leadBlock: "Days:1-10" as const,
          horizontalGridDegrees: 0.5 as const,
          profileGridPolicy: "coherent_0p50" as const,
          allCacheHit: true,
        },
      };
    });
    const service = new GefsReforecastTimeSeriesService({
      pointGetter: { getPoint: vi.fn() } as any,
      profileGetter: { getProfile } as any,
      stepConcurrency: 1,
    });

    const result = await service.getTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
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
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect(getProfile.mock.calls[0]?.[0]).toMatchObject({
      pressureLevelsHpa: [850, 500],
      includeMembers: false,
    });
  });

  it("constructs default collaborators without performing eager source work", () => {
    expect(() => new GefsReforecastTimeSeriesService()).not.toThrow();
  });

  it("rejects decoder drift across one retrospective range", async () => {
    let call = 0;
    const service = new GefsReforecastTimeSeriesService({
      pointGetter: {
        getPoint: vi.fn(async (query: any) => {
          call += 1;
          const validTime = new Date(query.validTime);
          const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
          return {
            model: "gefs_v12_reforecast",
            run: run.toISOString(),
            validTime: validTime.toISOString(),
            forecastHour,
            gridPoint: { latitude: 50, longitude: 14.5 },
            fieldSummaries: [{
              field: "temperature_2m",
              level: { gribLevel: "2 m above ground", description: "2 m above ground" },
              temporal: { type: "instantaneous" },
              outputs: [{
                aggregation: "numeric_distribution",
                field: "temperatureC",
                unit: "degC",
                distribution: distribution(10),
              }],
            }],
            source: {
              decoder: call === 1 ? "wgrib2" as const : "gribberish" as const,
              leadBlock: "Days:1-10" as const,
              horizontalGridDegrees: 0.25 as const,
              allCacheHit: true,
            },
          };
        }),
      } as any,
      profileGetter: { getProfile: vi.fn() } as any,
      stepConcurrency: 1,
    });

    await expect(service.getTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      selection: { kind: "fields", fields: ["temperature_2m"] },
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("changed decoder within one range");
  });

  it("rejects a collaborator result that drifts to another run", async () => {
    const service = new GefsReforecastTimeSeriesService({
      pointGetter: {
        getPoint: vi.fn(async (query: any) => {
          const validTime = new Date(query.validTime);
          const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
          return {
            model: "gefs_v12_reforecast",
            run: new Date(run.getTime() - 24 * 3_600_000).toISOString(),
            validTime: validTime.toISOString(),
            forecastHour,
            gridPoint: { latitude: 50, longitude: 14.5 },
            fieldSummaries: [],
            source: {
              decoder: "wgrib2" as const,
              leadBlock: "Days:1-10" as const,
              horizontalGridDegrees: 0.25 as const,
              allCacheHit: true,
            },
          };
        }),
      } as any,
      profileGetter: { getProfile: vi.fn() } as any,
      stepConcurrency: 1,
    });

    await expect(service.getTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T03:00:00Z",
      selection: { kind: "fields", fields: ["temperature_2m"] },
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("drifted between model runs");
  });


  it("rejects profile decoder drift across one retrospective range", async () => {
    let call = 0;
    const service = new GefsReforecastTimeSeriesService({
      pointGetter: { getPoint: vi.fn() } as any,
      profileGetter: {
        getProfile: vi.fn(async (query: any) => {
          call += 1;
          const validTime = new Date(query.validTime);
          const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
          return {
            model: "gefs_v12_reforecast",
            run: run.toISOString(),
            validTime: validTime.toISOString(),
            forecastHour,
            gridPoint: { latitude: 50, longitude: 14.5 },
            summaries: [{
              variable: "temperature",
              gfsCode: "TMP",
              pressureLevelHpa: 850,
              outputField: "temperatureC",
              unit: "degC",
              ...distribution(10),
            }],
            source: {
              decoder: call === 1 ? "wgrib2" as const : "gribberish" as const,
              leadBlock: "Days:1-10" as const,
              horizontalGridDegrees: 0.25 as const,
              profileGridPolicy: "native_0p25" as const,
              allCacheHit: true,
            },
          };
        }),
      } as any,
      stepConcurrency: 1,
    });

    await expect(service.getTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      selection: {
        kind: "profile",
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("changed decoder within one range");
  });

  it("rejects a collaborator result with a mismatched valid time", async () => {
    const service = new GefsReforecastTimeSeriesService({
      pointGetter: {
        getPoint: vi.fn(async (query: any) => {
          const requested = new Date(query.validTime);
          const forecastHour = (requested.getTime() - run.getTime()) / 3_600_000;
          return {
            model: "gefs_v12_reforecast",
            run: run.toISOString(),
            validTime: new Date(requested.getTime() + 3_600_000).toISOString(),
            forecastHour,
            gridPoint: { latitude: 50, longitude: 14.5 },
            fieldSummaries: [],
            source: {
              decoder: "wgrib2" as const,
              leadBlock: "Days:1-10" as const,
              horizontalGridDegrees: 0.25 as const,
              allCacheHit: true,
            },
          };
        }),
      } as any,
      profileGetter: { getProfile: vi.fn() } as any,
      stepConcurrency: 1,
    });

    await expect(service.getTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T03:00:00Z",
      selection: { kind: "fields", fields: ["temperature_2m"] },
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("inconsistent valid time or forecast hour");
  });

  it("rejects a collaborator result with a mismatched forecast hour", async () => {
    const service = new GefsReforecastTimeSeriesService({
      pointGetter: {
        getPoint: vi.fn(async (query: any) => {
          const validTime = new Date(query.validTime);
          const forecastHour = (validTime.getTime() - run.getTime()) / 3_600_000;
          return {
            model: "gefs_v12_reforecast",
            run: run.toISOString(),
            validTime: validTime.toISOString(),
            forecastHour: forecastHour + 3,
            gridPoint: { latitude: 50, longitude: 14.5 },
            fieldSummaries: [],
            source: {
              decoder: "wgrib2" as const,
              leadBlock: "Days:1-10" as const,
              horizontalGridDegrees: 0.25 as const,
              allCacheHit: true,
            },
          };
        }),
      } as any,
      profileGetter: { getProfile: vi.fn() } as any,
      stepConcurrency: 1,
    });

    await expect(service.getTimeSeries({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T03:00:00Z",
      selection: { kind: "fields", fields: ["temperature_2m"] },
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("inconsistent valid time or forecast hour");
  });

});
