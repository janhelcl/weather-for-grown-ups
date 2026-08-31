import { describe, expect, it, vi } from "vitest";
import {
  AIGEFS_MEMBERS,
  aigefsSourceMember,
  sortAigefsMembers,
} from "../src/catalog/aigefs.js";
import { ATMOSPHERIC_DATASET_CATALOG } from "../src/catalog/models.js";
import { AigefsForecastService } from "../src/core/aigefs.js";
import { AigefsQueryAdapter } from "../src/core/query-adapters/aigefs.js";
import { AigefsDiagnosticAdapter } from "../src/core/diagnostic-adapters/aigefs.js";
import {
  publicDatasetCapabilities,
  queryAtmosphereSchema,
  diagnoseAtmosphereSchema,
} from "../src/schema/unified-api.js";
import {
  buildAigefsS3IndexUrl,
  buildAigefsS3Url,
} from "../src/sources/aigefs.js";

describe("AIGEFS source and catalog", () => {
  it("maps canonical ensemble member names onto NOAA EAGLE member paths", () => {
    const run = new Date("2026-08-30T00:00:00Z");
    expect(AIGEFS_MEMBERS).toHaveLength(31);
    expect(aigefsSourceMember("c00")).toBe("mem000");
    expect(aigefsSourceMember("p30")).toBe("mem030");
    expect(buildAigefsS3Url(run, 6, "p01", "pres")).toBe(
      "https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com/EAGLE_ensemble/aigefs.20260830/00/mem001/model/atmos/grib2/aigefs.t00z.pres.f006.grib2",
    );
    expect(buildAigefsS3IndexUrl(run, 6, "p01", "pres")).toMatch(/\.grib2\.idx$/);
    expect(() => buildAigefsS3Url(run, -6, "c00", "pres")).toThrow("whole number from 0");
    expect(() => buildAigefsS3Url(run, 384.5, "c00", "pres")).toThrow("whole number from 0");
    expect(() => buildAigefsS3Url(run, 390, "c00", "pres")).toThrow("whole number from 0");
    expect(() => buildAigefsS3Url(run, 3, "c00", "pres")).toThrow("every 6 forecast hours");
  });

  it("registers AIGEFS as a first-class AI ensemble dataset", () => {
    expect(ATMOSPHERIC_DATASET_CATALOG.aigefs_0p25).toMatchObject({
      family: "aigefs",
      provider: "noaa",
      modelClass: "ai",
      kind: "ensemble",
      horizontalGridDegrees: 0.25,
      nativeForecastIntervalHours: 6,
      maxForecastHour: 384,
      members: 31,
    });
    expect(publicDatasetCapabilities("aigefs")).toMatchObject({
      dataset: "aigefs",
      modelClass: "ai",
      kind: "ensemble",
      provider: "noaa",
      operations: expect.arrayContaining([
        "profile",
        "timeseries",
        "layer_diagnostics",
        "profile_diagnostics",
        "diagnostic_timeseries",
        "points",
        "points_timeseries",
        "transect",
        "area_summary",
        "ensemble_distribution",
      ]),
    });
  });

  it("keeps AIGFS inventory boundaries and AIGEFS member selection explicit", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: {
        variables: ["relative_humidity"],
        pressureLevelsHpa: [850],
      },
      ensemble: { members: ["c00", "p01"] },
    })).toThrow("AIGEFS pressure variables not supported");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      ensemble: { members: ["c00", "bogus"] },
    })).toThrow("AIGEFS members are c00,p01..p30");

    expect(() => diagnoseAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850],
        parcel: "surface_2m",
      },
      ensemble: { members: ["c00", "p01"] },
    })).toThrow("AIGEFS parcel diagnostics are not exposed");
  });
});

describe("AIGEFS member-first aggregation", () => {
  it("runs one deterministic AIGFS calculation per member and summarizes point state", async () => {
    const calls: Array<{ member: string; request: any }> = [];
    const service = new AigefsForecastService({
      concurrency: 2,
      memberServiceFactory: (member) => ({
        query: vi.fn(async (request: any) => {
          calls.push({ member, request });
          const offset = member === "c00" ? 0 : 2;
          return {
            model: "aigfs_0p25",
            run: "2026-08-30T00:00:00.000Z",
            validTime: "2026-08-30T06:00:00.000Z",
            forecastHour: 6,
            requestedPoint: { latitude: 50.08, longitude: 14.43 },
            gridPoint: { latitude: 50, longitude: 14.5 },
            levels: [{
              pressureHpa: 850,
              temperatureC: 10 + offset,
              uWindMs: 3 + offset,
              vWindMs: 4,
              windSpeedMs: 5 + offset,
              windDirectionDeg: member === "c00" ? 350 : 10,
            }],
            fields: [{
              id: "temperature_2m",
              level: { type: "height_above_ground_m", heightM: 2 },
              temporal: { type: "instantaneous" },
              values: { temperatureC: 12 + offset },
            }],
            source: {
              provider: "NOAA NOMADS",
              access: "nomads_range",
              decoder: "gribberish",
              cacheHit: true,
            },
          };
        }),
        diagnose: vi.fn(),
      } as any),
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: {
        variables: ["temperature", "wind"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m"],
      },
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.5],
        includeMembers: true,
      },
    })) as any;

    expect(result.model).toBe("aigefs_0p25");
    expect(result.selection.members).toEqual(["c00", "p01"]);
    expect(result.pressureSummaries.find((summary: any) =>
      summary.field === "temperatureC",
    ).distribution).toMatchObject({
      memberCount: 2,
      mean: 11,
      min: 10,
      max: 12,
    });
    const direction = result.pressureSummaries.find((summary: any) =>
      summary.field === "windDirectionDeg",
    );
    expect(direction).toMatchObject({
      aggregation: "circular_direction",
      memberCount: 2,
    });
    expect(Math.min(
      Math.abs(direction.meanDirectionDeg),
      Math.abs(direction.meanDirectionDeg - 360),
    )).toBeLessThan(1e-10);
    expect(result.fieldSummaries[0].outputs[0].distribution.mean).toBe(13);
    expect(result.members).toHaveLength(2);
    expect(result.source).toMatchObject({
      provider: "NOAA EAGLE AWS Open Data",
      access: "s3_range",
      horizontalGridDegrees: 0.25,
      memberCount: 2,
      allCacheHit: true,
    });

    expect(calls[0]).toMatchObject({
      member: "c00",
      request: {
        dataset: "aigfs",
        forecast: { run: "latest" },
      },
    });
    expect(calls[1]).toMatchObject({
      member: "p01",
      request: {
        dataset: "aigfs",
        forecast: { run: "2026-08-30T00:00:00.000Z" },
      },
    });
  });

  it("derives nonlinear layer diagnostics inside each member before aggregation", async () => {
    const service = new AigefsForecastService({
      memberServiceFactory: (member) => ({
        query: vi.fn(),
        diagnose: vi.fn(async () => ({
          model: "aigfs_0p25",
          run: "2026-08-30T00:00:00.000Z",
          validTime: "2026-08-30T06:00:00.000Z",
          forecastHour: 6,
          requestedPoint: { latitude: 50.08, longitude: 14.43 },
          gridPoint: { latitude: 50, longitude: 14.5 },
          layer: {
            lowerPressureHpa: 850,
            upperPressureHpa: 700,
            lowerGeopotentialHeightGpm: 1500,
            upperGeopotentialHeightGpm: member === "c00" ? 3000 : 3200,
            depthGpm: member === "c00" ? 1500 : 1700,
          },
          levels: [],
          diagnostics: [{
            id: "temperature_lapse_rate",
            values: {
              temperatureLapseRateCPerKm: member === "c00" ? 6 : 8,
            },
          }],
          source: {
            provider: "NOAA NOMADS",
            access: "nomads_range",
            decoder: "gribberish",
            cacheHit: true,
          },
        })),
      } as any),
    });

    const result = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      ensemble: { members: ["c00", "p01"], quantiles: [0.5] },
    })) as any;

    expect(result.layerDepthGpm.mean).toBe(1600);
    expect(result.summaries.find((summary: any) =>
      summary.field === "temperatureLapseRateCPerKm",
    ).distribution.mean).toBe(7);
  });
});


describe("AIGEFS composition coverage", () => {
  const point = { latitude: 50.08, longitude: 14.43 };
  const gridPoint = { latitude: 50, longitude: 14.5 };
  const run = "2026-08-30T00:00:00.000Z";
  const instant = "2026-08-30T06:00:00.000Z";

  function factory(member: "c00" | "p01") {
    const offset = member === "c00" ? 0 : 2;
    const level = { pressureHpa: 850, temperatureC: 10 + offset };
    const source = {
      provider: "NOAA NOMADS",
      access: "nomads_range",
      decoder: "gribberish",
      cacheHit: member === "c00",
    };
    return {
      query: vi.fn(async (request: any) => {
        if (request.geometry.type === "point") {
          if ("from" in request.time) {
            return {
              model: "aigfs_0p25",
              run,
              requestedStartTime: request.time.from,
              requestedEndTime: request.time.to,
              requestedPoint: point,
              gridPoint,
              source: {
                provider: source.provider,
                access: source.access,
                decoder: source.decoder,
              },
              series: [{
                validTime: instant,
                forecastHour: 6,
                levels: [level],
                cacheHit: source.cacheHit,
              }],
            };
          }
          return {
            model: "aigfs_0p25",
            run,
            validTime: instant,
            forecastHour: 6,
            requestedPoint: point,
            gridPoint,
            levels: [level],
            source,
          };
        }

        if (request.geometry.type === "points") {
          const points = request.geometry.points.map((requestedPoint: any) => ({
            requestedPoint,
            gridPoint,
            levels: [level],
          }));
          if ("from" in request.time) {
            return {
              model: "aigfs_0p25",
              run,
              requestedStartTime: request.time.from,
              requestedEndTime: request.time.to,
              source: {
                provider: source.provider,
                access: source.access,
                decoder: source.decoder,
              },
              series: [{
                validTime: instant,
                forecastHour: 6,
                points,
                cacheHit: source.cacheHit,
              }],
            };
          }
          return {
            model: "aigfs_0p25",
            run,
            validTime: instant,
            forecastHour: 6,
            points,
            source,
          };
        }

        if (request.geometry.type === "transect") {
          return {
            model: "aigfs_0p25",
            run,
            validTime: instant,
            forecastHour: 6,
            startPoint: request.geometry.start,
            endPoint: request.geometry.end,
            totalDistanceKm: 100,
            samples: [request.geometry.start, request.geometry.end].map(
              (requestedPoint: any, index: number) => ({
                index,
                fraction: index,
                distanceKm: index * 100,
                requestedPoint,
                gridPoint,
                levels: [level],
              }),
            ),
            source,
          };
        }

        return {
          model: "aigfs_0p25",
          run,
          validTime: instant,
          forecastHour: 6,
          bbox: {
            westLongitude: request.geometry.westLongitude,
            eastLongitude: request.geometry.eastLongitude,
            southLatitude: request.geometry.southLatitude,
            northLatitude: request.geometry.northLatitude,
          },
          variable: {
            id: "temperature",
            pressureHpa: 850,
            field: "temperatureC",
            unit: "degC",
          },
          statistics: {
            definedGridPoints: 4,
            mean: 10 + offset,
            min: 8 + offset,
            max: 12 + offset,
            meanKind: "unweighted_grid_point_mean",
          },
          distribution: {
            percentiles: [{ percentile: 50, value: 10 + offset }],
            thresholdFractions: [{
              operator: "gte",
              threshold: 10,
              count: 2,
              fraction: 0.5,
            }],
            extrema: {
              min: { value: 8 + offset, gridPoint },
              max: { value: 12 + offset, gridPoint },
            },
          },
          source,
        };
      }),
      diagnose: vi.fn(async (request: any) => {
        const diagnostics = [{
          id: "freezing_level_crossings",
          crossings: member === "c00"
            ? []
            : [{ pressureHpa: 800, geopotentialHeightGpm: 1800 }],
        }];
        if ("from" in request.time) {
          return {
            model: "aigfs_0p25",
            run,
            requestedStartTime: request.time.from,
            requestedEndTime: request.time.to,
            requestedPoint: point,
            gridPoint,
            source: {
              provider: source.provider,
              access: source.access,
              decoder: source.decoder,
            },
            diagnostic: request.diagnostic,
            series: [{
              kind: "profile",
              validTime: instant,
              forecastHour: 6,
              diagnostics,
              cacheHit: source.cacheHit,
            }],
          };
        }
        return {
          model: "aigfs_0p25",
          run,
          validTime: instant,
          forecastHour: 6,
          requestedPoint: point,
          gridPoint,
          sampledPressureLevelsHpa: [1000, 850],
          levels: [],
          diagnostics,
          source,
        };
      }),
    } as any;
  }

  function service() {
    return new AigefsForecastService({
      memberServiceFactory: (member) => factory(member as "c00" | "p01"),
    });
  }

  const ensemble = {
    members: ["c00", "p01"],
    quantiles: [0.5],
  };

  it("composes ranges, multi-point state, multi-point ranges, and transects", async () => {
    const range = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", ...point },
      time: { from: instant, to: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble,
    })) as any;
    expect(range.series[0].pressureSummaries[0].distribution.mean).toBe(11);
    expect(range.source.allCacheHit).toBe(false);

    const points = [{ latitude: 50.08, longitude: 14.43 }, { latitude: 49.2, longitude: 16.61 }];
    const multi = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "points", points },
      time: { at: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { ...ensemble, includeMembers: true },
    })) as any;
    expect(multi.points).toHaveLength(2);
    expect(multi.members).toHaveLength(2);

    const matrix = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "points", points },
      time: { from: instant, to: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble,
    })) as any;
    expect(matrix.series[0].points).toHaveLength(2);

    const transect = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: {
        type: "transect",
        start: { latitude: 49, longitude: 14 },
        end: { latitude: 50, longitude: 15 },
        samples: 2,
      },
      time: { at: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble,
    })) as any;
    expect(transect.samples).toHaveLength(2);
  });

  it("aggregates member-level area evidence without flattening member × grid cells", async () => {
    const area = await service().query(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49,
        northLatitude: 49.5,
      },
      time: { at: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { ...ensemble, includeMembers: true },
      aggregate: {
        percentiles: [50],
        thresholds: [{ operator: "gte", value: 10 }],
        includeExtremaLocations: true,
      },
      limits: { maxMemberGridPoints: 100 },
    })) as any;

    expect(area.methodology).toBe("spatial_statistics_per_member_then_ensemble_distribution");
    expect(area.statistics.mean.mean).toBe(11);
    expect(area.spatialPercentiles[0].distribution.mean).toBe(11);
    expect(area.spatialThresholdFractions[0].distribution.mean).toBe(0.5);
    expect(area.memberExtrema).toHaveLength(2);
    expect(area.members).toHaveLength(2);

    await expect(service().query(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49,
        northLatitude: 49.5,
      },
      time: { at: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble,
      limits: { maxMemberGridPoints: 2 },
    }))).rejects.toThrow("exceeding maxMemberGridPoints=2");
  });

  it("aggregates structural profile diagnostics at one time and through a range", async () => {
    const instantResult = await service().diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", ...point },
      time: { at: instant },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 850],
        diagnostics: ["freezing_level_crossings"],
      },
      ensemble: { ...ensemble, includeMembers: true },
    })) as any;
    expect(instantResult.summaries[0].membersWithAnyCrossing.fraction).toBe(0.5);
    expect(instantResult.members).toHaveLength(2);

    const range = await service().diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", ...point },
      time: { from: instant, to: instant },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 850],
        diagnostics: ["freezing_level_crossings"],
      },
      ensemble,
    })) as any;
    expect(range.series[0].summaries[0].membersWithAnyCrossing.fraction).toBe(0.5);
  });

  it("keeps direct service misuse and member guardrails explicit", async () => {
    await expect(service().query({
      dataset: "gfs",
      geometry: { type: "point", ...point },
      time: { at: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    } as any)).rejects.toThrow("only accepts dataset=aigefs");

    await expect(service().diagnose({
      dataset: "gfs",
      geometry: { type: "point", ...point },
      time: { at: instant },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 850],
        diagnostics: ["freezing_level_crossings"],
      },
    } as any)).rejects.toThrow("only accepts dataset=aigefs");

    await expect(service().query({
      dataset: "aigefs",
      geometry: { type: "point", ...point },
      time: { at: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["c00"], quantiles: [0.5] },
    } as any)).rejects.toThrow("at least two selected members");

    expect(() => aigefsSourceMember("not-a-member" as any)).toThrow("Unknown AIGEFS member");
  });
});


describe("AIGEFS remaining guard branches", () => {
  it("keeps canonical ordering even when a direct internal caller supplies an unknown member", () => {
    expect(sortAigefsMembers(["p01", "c00"])).toEqual(["c00", "p01"]);
    expect(sortAigefsMembers(["not-a-member", "c00"] as any)).toEqual(["c00", "not-a-member"]);
  });

  it("supports dependency injection through both unified adapters", async () => {
    const query = vi.fn(async () => ({ route: "aigefs-query" }));
    const diagnose = vi.fn(async () => ({ route: "aigefs-diagnose" }));
    const queryAdapter = new AigefsQueryAdapter({ aigefs: { query } as any });
    const diagnosticAdapter = new AigefsDiagnosticAdapter({
      aigefsDiagnostics: { diagnose } as any,
    });

    expect(await queryAdapter.query({ dataset: "aigefs" } as any)).toEqual({
      route: "aigefs-query",
    });
    expect(await diagnosticAdapter.diagnose({ dataset: "aigefs" } as any)).toEqual({
      route: "aigefs-diagnose",
    });
    expect(query).toHaveBeenCalledOnce();
    expect(diagnose).toHaveBeenCalledOnce();
  });

  it("rejects member grid disagreement before producing an ensemble point", async () => {
    const service = new AigefsForecastService({
      memberServiceFactory: (member) => ({
        query: vi.fn(async () => ({
          model: "aigfs_0p25",
          run: "2026-08-30T00:00:00.000Z",
          validTime: "2026-08-30T06:00:00.000Z",
          forecastHour: 6,
          requestedPoint: { latitude: 50.08, longitude: 14.43 },
          gridPoint: {
            latitude: 50,
            longitude: member === "c00" ? 14.5 : 14.75,
          },
          levels: [{ pressureHpa: 850, temperatureC: 10 }],
          source: {
            provider: "NOAA NOMADS",
            access: "nomads_range",
            decoder: "gribberish",
            cacheHit: true,
          },
        })),
        diagnose: vi.fn(),
      } as any),
    });

    await expect(service.query(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["c00", "p01"], quantiles: [0.5] },
    }))).rejects.toThrow("inconsistent grid points");
  });
});
