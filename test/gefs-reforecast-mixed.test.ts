import { describe, expect, it, vi } from "vitest";
import {
  GefsReforecastMixedPointService,
  GefsReforecastMixedPointsService,
  GefsReforecastMixedTimeSeriesService,
  GefsReforecastMixedPointsTimeSeriesService,
} from "../src/core/gefs-reforecast-mixed.js";
import type { GefsReforecastMixedPointResult } from "../src/schema/gefs-reforecast-mixed.js";

const run = "2017-03-14T00:00:00.000Z";
const validTime = "2017-03-14T12:00:00.000Z";
const requestedPoint = { latitude: 50.08, longitude: 14.43 };
const members = ["c00", "p01"] as const;
const quantiles = [0.5] as const;

function profileResult(overrides: any = {}) {
  return {
    model: "gefs_v12_reforecast" as const,
    run,
    validTime,
    forecastHour: 12,
    requestedPoint,
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: {
      variables: ["temperature"] as const,
      pressureLevelsHpa: [850, 500],
      members: [...members],
      quantiles: [...quantiles],
    },
    summaries: [
      {
        variable: "temperature" as const,
        gfsCode: "TMP",
        pressureLevelHpa: 850,
        outputField: "temperatureC",
        unit: "degC",
        memberCount: 2,
        mean: 7,
        populationStdDev: 1,
        min: 6,
        max: 8,
        quantiles: [{ quantile: 0.5, value: 7 }],
      },
      {
        variable: "temperature" as const,
        gfsCode: "TMP",
        pressureLevelHpa: 500,
        outputField: "temperatureC",
        unit: "degC",
        memberCount: 2,
        mean: -20,
        populationStdDev: 1,
        min: -21,
        max: -19,
        quantiles: [{ quantile: 0.5, value: -20 }],
      },
    ],
    members: [
      {
        member: "c00" as const,
        cacheHit: true,
        values: [
          { variable: "temperature" as const, pressureLevelHpa: 850, value: 6 },
          { variable: "temperature" as const, pressureLevelHpa: 500, value: -21 },
        ],
      },
      {
        member: "p01" as const,
        cacheHit: false,
        values: [
          { variable: "temperature" as const, pressureLevelHpa: 850, value: 8 },
          { variable: "temperature" as const, pressureLevelHpa: 500, value: -19 },
        ],
      },
    ],
    source: {
      provider: "NOAA AWS Open Data" as const,
      access: "s3_range" as const,
      decoder: "gribberish" as const,
      archiveType: "reforecast" as const,
      dataset: "GEFSv12/reforecast" as const,
      leadBlock: "Days:1-10" as const,
      horizontalGridDegrees: 0.5 as const,
      profileGridPolicy: "coherent_0p50" as const,
      allCacheHit: false,
    },
    ...overrides,
  };
}

function fieldResult(overrides: any = {}) {
  return {
    model: "gefs_v12_reforecast" as const,
    run,
    validTime,
    forecastHour: 12,
    requestedPoint,
    gridPoint: { latitude: 50, longitude: 14.25 },
    selection: {
      fields: ["temperature_2m"] as const,
      members: [...members],
      quantiles: [...quantiles],
    },
    fieldSummaries: [{
      field: "temperature_2m" as const,
      level: { gribLevel: "2 m above ground", description: "2 m above ground" },
      temporal: { type: "instantaneous" as const },
      outputs: [{
        aggregation: "numeric_distribution" as const,
        field: "temperatureC",
        unit: "degC",
        distribution: {
          memberCount: 2,
          mean: 8,
          populationStdDev: 1,
          min: 7,
          max: 9,
          quantiles: [{ quantile: 0.5, value: 8 }],
        },
      }],
    }],
    members: [
      {
        member: "c00" as const,
        cacheHit: true,
        fields: [{
          field: "temperature_2m" as const,
          temporal: { type: "instantaneous" as const },
          values: { temperatureC: 7 },
        }],
      },
      {
        member: "p01" as const,
        cacheHit: false,
        fields: [{
          field: "temperature_2m" as const,
          temporal: { type: "instantaneous" as const },
          values: { temperatureC: 9 },
        }],
      },
    ],
    source: {
      provider: "NOAA AWS Open Data" as const,
      access: "s3_range" as const,
      decoder: "gribberish" as const,
      archiveType: "reforecast" as const,
      dataset: "GEFSv12/reforecast" as const,
      leadBlock: "Days:1-10" as const,
      horizontalGridDegrees: 0.25 as const,
      allCacheHit: false,
    },
    ...overrides,
  };
}

function mixedResult(
  point = requestedPoint,
  time = validTime,
  forecastHour = 12,
  allCacheHit = false,
): GefsReforecastMixedPointResult {
  const pressure = profileResult({
    validTime: time,
    forecastHour,
    requestedPoint: point,
    ...(forecastHour > 240
      ? {
          gridPoint: { latitude: 50, longitude: 14.5 },
          source: {
            ...profileResult().source,
            leadBlock: "Days:10-16" as const,
            horizontalGridDegrees: 0.5 as const,
            profileGridPolicy: "native_0p50" as const,
            allCacheHit,
          },
        }
      : {}),
  });
  const fields = fieldResult({
    validTime: time,
    forecastHour,
    requestedPoint: point,
    ...(forecastHour > 240
      ? {
          gridPoint: { latitude: 50, longitude: 14.5 },
          source: {
            ...fieldResult().source,
            leadBlock: "Days:10-16" as const,
            horizontalGridDegrees: 0.5 as const,
            allCacheHit,
          },
        }
      : {}),
  });
  return {
    model: "gefs_v12_reforecast",
    kind: "mixed",
    run,
    validTime: time,
    forecastHour,
    requestedPoint: point,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    },
    pressure: {
      gridPoint: pressure.gridPoint,
      summaries: pressure.summaries,
      source: {
        horizontalGridDegrees: pressure.source.horizontalGridDegrees,
        profileGridPolicy: pressure.source.profileGridPolicy,
        allCacheHit,
      },
    },
    fields: {
      gridPoint: fields.gridPoint,
      fieldSummaries: fields.fieldSummaries,
      source: {
        horizontalGridDegrees: fields.source.horizontalGridDegrees,
        allCacheHit,
      },
    },
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "gribberish",
      archiveType: "reforecast",
      dataset: "GEFSv12/reforecast",
      leadBlock: forecastHour > 240 ? "Days:10-16" : "Days:1-10",
      gridSemantics: "pressure_and_field_grids_reported_separately",
      allCacheHit,
    },
  };
}

describe("GEFSv12 mixed retrospective point service", () => {
  it("preserves separate pressure and field grids while aligning one selection", async () => {
    const profileGetter = { getProfile: vi.fn(async () => profileResult()) };
    const fieldGetter = { getPoint: vi.fn(async () => fieldResult()) };
    const result = await new GefsReforecastMixedPointService({
      profileGetter: profileGetter as any,
      fieldGetter: fieldGetter as any,
    }).getPoint({
      ...requestedPoint,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [500, 850],
      fields: ["temperature_2m"],
      members: ["p01", "c00"],
      quantiles: [0.5],
      includeMembers: true,
    });

    expect(result.selection.members).toEqual(["c00", "p01"]);
    expect(result.selection.pressureLevelsHpa).toEqual([850, 500]);
    expect(result.pressure.gridPoint).toEqual({ latitude: 50, longitude: 14.5 });
    expect(result.fields.gridPoint).toEqual({ latitude: 50, longitude: 14.25 });
    expect(result.pressure.source).toMatchObject({
      horizontalGridDegrees: 0.5,
      profileGridPolicy: "coherent_0p50",
    });
    expect(result.fields.source.horizontalGridDegrees).toBe(0.25);
    expect(result.source.gridSemantics)
      .toBe("pressure_and_field_grids_reported_separately");
    expect(result.pressure.members).toHaveLength(2);
    expect(result.fields.members).toHaveLength(2);
  });

  it("rejects retrospective lead-block drift between pressure and fields", async () => {
    const service = new GefsReforecastMixedPointService({
      profileGetter: { getProfile: async () => profileResult() } as any,
      fieldGetter: {
        getPoint: async () => fieldResult({
          source: {
            ...fieldResult().source,
            leadBlock: "Days:10-16" as const,
          },
        }),
      } as any,
    });

    await expect(service.getPoint({
      ...requestedPoint,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("inconsistent retrospective lead blocks");
  });

  it("rejects selection drift between pressure and field branches", async () => {
    const service = new GefsReforecastMixedPointService({
      profileGetter: { getProfile: async () => profileResult() } as any,
      fieldGetter: {
        getPoint: async () => fieldResult({
          selection: {
            ...fieldResult().selection,
            quantiles: [0.25],
          },
        }),
      } as any,
    });

    await expect(service.getPoint({
      ...requestedPoint,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("changed selection between pressure and field branches");
  });

  it("rejects metadata or decoder drift between the two native branches", async () => {
    const service = new GefsReforecastMixedPointService({
      profileGetter: { getProfile: async () => profileResult() } as any,
      fieldGetter: {
        getPoint: async () => fieldResult({
          source: { ...fieldResult().source, decoder: "wgrib2" as const },
        }),
      } as any,
    });

    await expect(service.getPoint({
      ...requestedPoint,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("different decoders");
  });

  it("rejects omitted member payloads when they were explicitly requested", async () => {
    const service = new GefsReforecastMixedPointService({
      profileGetter: {
        getProfile: async () => {
          const { members: _members, ...result } = profileResult();
          return result as any;
        },
      } as any,
      fieldGetter: { getPoint: async () => fieldResult() } as any,
    });

    await expect(service.getPoint({
      ...requestedPoint,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
      includeMembers: true,
    })).rejects.toThrow("omitted requested member payloads");
  });
});

describe("GEFSv12 mixed retrospective spatial/time wrappers", () => {
  it("keeps multi-point ordering and aggregates cache provenance", async () => {
    const pointGetter = {
      getPoint: vi.fn(async (query: any) =>
        mixedResult(
          { latitude: query.latitude, longitude: query.longitude },
          query.validTime,
          12,
          query.longitude === 14.43,
        )),
    };
    const result = await new GefsReforecastMixedPointsService({
      pointGetter: pointGetter as any,
      pointConcurrency: 2,
    }).getPoints({
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.2, longitude: 16.61 },
      ],
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    });

    expect(result.points.map((point) => point.requestedPoint)).toEqual([
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 49.2, longitude: 16.61 },
    ]);
    expect(result.source.allCacheHit).toBe(false);
  });

  it("enforces the mixed raw-member scalar budget before fetching points", async () => {
    const pointGetter = { getPoint: vi.fn() };
    const service = new GefsReforecastMixedPointsService({
      pointGetter: pointGetter as any,
    });

    await expect(service.getPoints({
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.2, longitude: 16.61 },
      ],
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["wind_10m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
      includeMembers: true,
      maxMemberSamples: 10,
    })).rejects.toThrow("exceeding maxMemberSamples=10");
    expect(pointGetter.getPoint).not.toHaveBeenCalled();
  });

  it("rejects mixed point ranges whose step selection drifts", async () => {
    let call = 0;
    const pointGetter = {
      getPoint: vi.fn(async (query: any) => {
        call += 1;
        const hour = (new Date(query.validTime).getTime() - new Date(run).getTime()) / 3_600_000;
        const result = mixedResult(
          requestedPoint,
          new Date(query.validTime).toISOString(),
          hour,
        );
        return call === 2
          ? {
              ...result,
              selection: {
                ...result.selection,
                quantiles: [0.25],
              },
            }
          : result;
      }),
    };

    await expect(new GefsReforecastMixedTimeSeriesService({
      pointGetter: pointGetter as any,
    }).getTimeSeries({
      ...requestedPoint,
      run,
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxSteps: 2,
    })).rejects.toThrow("changed shared semantics between steps");
  });

  it("rejects mixed multi-point batches that change point ordering", async () => {
    const requested = [
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 49.2, longitude: 16.61 },
    ];
    const pointGetter = {
      getPoint: vi.fn(async (query: any) =>
        mixedResult(
          query.longitude === 14.43
            ? { latitude: 49.2, longitude: 16.61 }
            : { latitude: 50.08, longitude: 14.43 },
          query.validTime,
          12,
        )),
    };

    await expect(new GefsReforecastMixedPointsService({
      pointGetter: pointGetter as any,
    }).getPoints({
      points: requested,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("changed shared semantics between points");
  });

  it("builds compact native-cadence mixed point ranges", async () => {
    const pointGetter = {
      getPoint: vi.fn(async (query: any) => {
        const hour = (new Date(query.validTime).getTime() - new Date(run).getTime()) / 3_600_000;
        return mixedResult(requestedPoint, new Date(query.validTime).toISOString(), hour);
      }),
    };
    const result = await new GefsReforecastMixedTimeSeriesService({
      pointGetter: pointGetter as any,
    }).getTimeSeries({
      ...requestedPoint,
      run,
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxSteps: 2,
    });

    expect(result.series.map((step) => step.forecastHour)).toEqual([3, 6]);
    expect(result.series.every((step) => !("members" in step.pressure))).toBe(true);
    expect(result.source.nativeCadence).toEqual([
      { fromForecastHour: 3, throughForecastHour: 240, stepHours: 3 },
      { fromForecastHour: 246, throughForecastHour: 384, stepHours: 6 },
    ]);
  });

  it("rejects mixed multi-point ranges that exceed the point-step budget", async () => {
    const pointsGetter = { getPoints: vi.fn() };
    const service = new GefsReforecastMixedPointsTimeSeriesService({
      pointsGetter: pointsGetter as any,
    });

    await expect(service.getPointsTimeSeries({
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.2, longitude: 16.61 },
      ],
      run,
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxSteps: 2,
      maxPointSteps: 3,
    })).rejects.toThrow("exceeding maxPointSteps=3");
    expect(pointsGetter.getPoints).not.toHaveBeenCalled();
  });

  it("rejects mixed multi-point ranges whose batch selection drifts", async () => {
    const requested = [
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 49.2, longitude: 16.61 },
    ];
    let call = 0;
    const pointsGetter = {
      getPoints: vi.fn(async (query: any) => {
        call += 1;
        const hour = (new Date(query.validTime).getTime() - new Date(run).getTime()) / 3_600_000;
        const points = requested.map((point) =>
          mixedResult(point, new Date(query.validTime).toISOString(), hour));
        const selection = {
          ...points[0]!.selection,
          ...(call === 2 ? { quantiles: [0.25] } : {}),
        };
        return {
          model: "gefs_v12_reforecast" as const,
          kind: "mixed" as const,
          run,
          validTime: new Date(query.validTime).toISOString(),
          forecastHour: hour,
          selection,
          includeMembers: false,
          points: points.map((point) => ({
            requestedPoint: point.requestedPoint,
            pressure: point.pressure,
            fields: point.fields,
          })),
          source: points[0]!.source,
        };
      }),
    };

    await expect(new GefsReforecastMixedPointsTimeSeriesService({
      pointsGetter: pointsGetter as any,
    }).getPointsTimeSeries({
      points: requested,
      run,
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxSteps: 2,
      maxPointSteps: 4,
    })).rejects.toThrow("changed shared semantics between steps");
  });

  it("rejects mixed multi-point ranges that reorder requested points", async () => {
    const requested = [
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 49.2, longitude: 16.61 },
    ];
    const pointsGetter = {
      getPoints: vi.fn(async (query: any) => {
        const hour = (new Date(query.validTime).getTime() - new Date(run).getTime()) / 3_600_000;
        const points = requested.map((point) =>
          mixedResult(point, new Date(query.validTime).toISOString(), hour));
        return {
          model: "gefs_v12_reforecast" as const,
          kind: "mixed" as const,
          run,
          validTime: new Date(query.validTime).toISOString(),
          forecastHour: hour,
          selection: points[0]!.selection,
          includeMembers: false,
          points: [
            {
              requestedPoint: requested[1]!,
              pressure: points[0]!.pressure,
              fields: points[0]!.fields,
            },
            {
              requestedPoint: requested[0]!,
              pressure: points[1]!.pressure,
              fields: points[1]!.fields,
            },
          ],
          source: points[0]!.source,
        };
      }),
    };

    await expect(new GefsReforecastMixedPointsTimeSeriesService({
      pointsGetter: pointsGetter as any,
    }).getPointsTimeSeries({
      points: requested,
      run,
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxSteps: 2,
      maxPointSteps: 4,
    })).rejects.toThrow("changed point ordering");
  });

  it("builds compact mixed multi-point ranges without forcing stable grids", async () => {
    const requested = [
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 49.2, longitude: 16.61 },
    ];
    const pointsGetter = {
      getPoints: vi.fn(async (query: any) => {
        const hour = (new Date(query.validTime).getTime() - new Date(run).getTime()) / 3_600_000;
        const points = requested.map((point) => mixedResult(point, new Date(query.validTime).toISOString(), hour));
        return {
          model: "gefs_v12_reforecast" as const,
          kind: "mixed" as const,
          run,
          validTime: new Date(query.validTime).toISOString(),
          forecastHour: hour,
          selection: points[0]!.selection,
          includeMembers: false,
          points: points.map((point) => ({
            requestedPoint: point.requestedPoint,
            pressure: point.pressure,
            fields: point.fields,
          })),
          source: points[0]!.source,
        };
      }),
    };

    const result = await new GefsReforecastMixedPointsTimeSeriesService({
      pointsGetter: pointsGetter as any,
    }).getPointsTimeSeries({
      points: requested,
      run,
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxSteps: 2,
      maxPointSteps: 4,
    });

    expect(result.series).toHaveLength(2);
    expect(result.series[0]!.points.map((point) => point.requestedPoint)).toEqual(requested);
  });
});
