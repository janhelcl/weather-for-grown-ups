import { describe, expect, it, vi } from "vitest";
import {
  AIFS_ENS_MEMBERS,
  aifsEnsPerturbationNumber,
  sortAifsEnsMembers,
} from "../src/catalog/aifs-ens.js";
import { ATMOSPHERIC_DATASET_CATALOG } from "../src/catalog/models.js";
import { AifsEnsForecastService } from "../src/core/aifs-ens.js";
import { AifsEnsQueryAdapter } from "../src/core/query-adapters/aifs-ens.js";
import { AifsEnsDiagnosticAdapter } from "../src/core/diagnostic-adapters/aifs-ens.js";
import {
  diagnoseAtmosphereSchema,
  publicDatasetCapabilities,
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";
import {
  aifsEnsSelectorsForMember,
  buildAifsEnsOpenDataForecastIndexUrl,
  buildAifsEnsOpenDataForecastUrl,
} from "../src/sources/aifs-ens-open-data.js";

describe("AIFS ENS source and catalog", () => {
  it("preserves native control and perturbed Open Data packaging", () => {
    const run = new Date("2026-08-31T00:00:00Z");
    expect(AIFS_ENS_MEMBERS).toHaveLength(51);
    expect(aifsEnsPerturbationNumber("c00")).toBeUndefined();
    expect(aifsEnsPerturbationNumber("p50")).toBe(50);
    expect(sortAifsEnsMembers(["p50", "c00", "p01"])).toEqual(["c00", "p01", "p50"]);

    expect(buildAifsEnsOpenDataForecastUrl(run, 6, "c00")).toBe(
      "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20260831/00z/aifs-ens/0p25/enfo/20260831000000-6h-enfo-cf.grib2",
    );
    expect(buildAifsEnsOpenDataForecastUrl(run, 6, "p01")).toBe(
      "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20260831/00z/aifs-ens/0p25/enfo/20260831000000-6h-enfo-pf.grib2",
    );
    expect(buildAifsEnsOpenDataForecastIndexUrl(run, 6, "p01")).toMatch(/-pf\.index$/);

    const selectors = [{ key: "t@850", param: "t", levtype: "pl" as const, levelist: 850, number: 99 }];
    expect(aifsEnsSelectorsForMember("c00", selectors)[0]).not.toHaveProperty("number");
    expect(aifsEnsSelectorsForMember("p50", selectors)[0]).toMatchObject({ number: 50 });
  });

  it("registers a 51-member AI ensemble without conflating AIFS Single", () => {
    expect(ATMOSPHERIC_DATASET_CATALOG.aifs_ens_0p25).toMatchObject({
      family: "aifs",
      provider: "ecmwf",
      modelClass: "ai",
      kind: "ensemble",
      role: "forecast",
      horizontalGridDegrees: 0.25,
      nativeForecastIntervalHours: 6,
      maxForecastHour: 360,
      members: 51,
    });
    expect(publicDatasetCapabilities("aifs-ens")).toMatchObject({
      dataset: "aifs-ens",
      modelClass: "ai",
      kind: "ensemble",
      provider: "ecmwf",
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
    expect(ATMOSPHERIC_DATASET_CATALOG.aifs_0p25.kind).toBe("deterministic");
  });

  it("validates the full member vocabulary and AIFS capability boundaries", () => {
    expect(queryAtmosphereSchema.parse({
      dataset: "aifs-ens",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: [...AIFS_ENS_MEMBERS] },
    }).ensemble?.members).toHaveLength(51);

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aifs-ens",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["c00", "bogus"] },
    })).toThrow("AIFS ENS members are c00,p01..p50");

    expect(() => diagnoseAtmosphereSchema.parse({
      dataset: "aifs-ens",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850],
        parcel: "surface_2m",
      },
      ensemble: { members: ["c00", "p01"] },
    })).toThrow("AIFS parcel diagnostics are not exposed");
  });
});

describe("AIFS ENS member-first aggregation", () => {
  it("runs deterministic AIFS once per member and pins the resolved run", async () => {
    const calls: Array<{ member: string; request: any }> = [];
    const service = new AifsEnsForecastService({
      concurrency: 2,
      memberServiceFactory: (member) => ({
        query: vi.fn(async (request: any) => {
          calls.push({ member, request });
          const offset = member === "c00" ? 0 : 2;
          return {
            model: "aifs_0p25",
            run: "2026-08-31T00:00:00.000Z",
            validTime: "2026-08-31T06:00:00.000Z",
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
              provider: "ECMWF Open Data",
              access: "indexed_http_range",
              decoder: "gribberish",
              cacheHit: true,
            },
          };
        }),
        diagnose: vi.fn(),
      } as any),
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "aifs-ens",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
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

    expect(result.model).toBe("aifs_ens_0p25");
    expect(result.selection.members).toEqual(["c00", "p01"]);
    expect(result.pressureSummaries.find((summary: any) =>
      summary.field === "temperatureC",
    ).distribution).toMatchObject({
      memberCount: 2,
      mean: 11,
      min: 10,
      max: 12,
    });
    expect(result.fieldSummaries[0].outputs[0].distribution.mean).toBe(13);
    expect(result.members).toHaveLength(2);
    expect(result.source).toMatchObject({
      provider: "ECMWF Open Data",
      product: "aifs_ens_0p25_enfo_cf_pf",
      access: "indexed_http_range",
      horizontalGridDegrees: 0.25,
      memberCount: 2,
      allCacheHit: true,
    });

    expect(calls[0]).toMatchObject({
      member: "c00",
      request: {
        dataset: "aifs",
        forecast: { run: "latest" },
      },
    });
    expect(calls[1]).toMatchObject({
      member: "p01",
      request: {
        dataset: "aifs",
        forecast: { run: "2026-08-31T00:00:00.000Z" },
      },
    });
  });

  it("aggregates nonlinear layer diagnostics only after per-member derivation", async () => {
    const service = new AifsEnsForecastService({
      memberServiceFactory: (member) => ({
        query: vi.fn(),
        diagnose: vi.fn(async () => ({
          model: "aifs_0p25",
          run: "2026-08-31T00:00:00.000Z",
          validTime: "2026-08-31T06:00:00.000Z",
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
            provider: "ECMWF Open Data",
            access: "indexed_http_range",
            decoder: "gribberish",
            cacheHit: true,
          },
        })),
      } as any),
    });

    const result = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "aifs-ens",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
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

  it("keeps query and diagnostic adapters injectable", async () => {
    const query = vi.fn(async () => ({ route: "aifs-ens-query" }));
    const diagnose = vi.fn(async () => ({ route: "aifs-ens-diagnose" }));
    const queryAdapter = new AifsEnsQueryAdapter({ aifsEns: { query } as any });
    const diagnosticAdapter = new AifsEnsDiagnosticAdapter({
      aifsEnsDiagnostics: { diagnose } as any,
    });

    expect(await queryAdapter.query({ dataset: "aifs-ens" } as any))
      .toEqual({ route: "aifs-ens-query" });
    expect(await diagnosticAdapter.diagnose({ dataset: "aifs-ens" } as any))
      .toEqual({ route: "aifs-ens-diagnose" });
  });
});

describe("AIFS ENS composition coverage", () => {
  const point = { latitude: 50.08, longitude: 14.43 };
  const gridPoint = { latitude: 50, longitude: 14.5 };
  const run = "2026-08-30T00:00:00.000Z";
  const instant = "2026-08-30T06:00:00.000Z";

  function factory(member: "c00" | "p01") {
    const offset = member === "c00" ? 0 : 2;
    const level = { pressureHpa: 850, temperatureC: 10 + offset };
    const source = {
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      cacheHit: member === "c00",
    };
    return {
      query: vi.fn(async (request: any) => {
        if (request.geometry.type === "point") {
          if ("from" in request.time) {
            return {
              model: "aifs_0p25",
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
            model: "aifs_0p25",
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
              model: "aifs_0p25",
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
            model: "aifs_0p25",
            run,
            validTime: instant,
            forecastHour: 6,
            points,
            source,
          };
        }

        if (request.geometry.type === "transect") {
          return {
            model: "aifs_0p25",
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
          model: "aifs_0p25",
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
            model: "aifs_0p25",
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
          model: "aifs_0p25",
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
    return new AifsEnsForecastService({
      memberServiceFactory: (member) => factory(member as "c00" | "p01"),
    });
  }

  const ensemble = {
    members: ["c00", "p01"],
    quantiles: [0.5],
  };

  it("composes ranges, multi-point state, multi-point ranges, and transects", async () => {
    const range = await service().query(queryAtmosphereSchema.parse({
      dataset: "aifs-ens",
      geometry: { type: "point", ...point },
      time: { from: instant, to: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble,
    })) as any;
    expect(range.series[0].pressureSummaries[0].distribution.mean).toBe(11);
    expect(range.source.allCacheHit).toBe(false);

    const points = [{ latitude: 50.08, longitude: 14.43 }, { latitude: 49.2, longitude: 16.61 }];
    const multi = await service().query(queryAtmosphereSchema.parse({
      dataset: "aifs-ens",
      geometry: { type: "points", points },
      time: { at: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { ...ensemble, includeMembers: true },
    })) as any;
    expect(multi.points).toHaveLength(2);
    expect(multi.members).toHaveLength(2);

    const matrix = await service().query(queryAtmosphereSchema.parse({
      dataset: "aifs-ens",
      geometry: { type: "points", points },
      time: { from: instant, to: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble,
    })) as any;
    expect(matrix.series[0].points).toHaveLength(2);

    const transect = await service().query(queryAtmosphereSchema.parse({
      dataset: "aifs-ens",
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
      dataset: "aifs-ens",
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
      dataset: "aifs-ens",
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
      dataset: "aifs-ens",
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
      dataset: "aifs-ens",
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
    } as any)).rejects.toThrow("only accepts dataset=aifs-ens");

    await expect(service().diagnose({
      dataset: "gfs",
      geometry: { type: "point", ...point },
      time: { at: instant },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 850],
        diagnostics: ["freezing_level_crossings"],
      },
    } as any)).rejects.toThrow("only accepts dataset=aifs-ens");

    await expect(service().query({
      dataset: "aifs-ens",
      geometry: { type: "point", ...point },
      time: { at: instant },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["c00"], quantiles: [0.5] },
    } as any)).rejects.toThrow("at least two selected members");
  });
});


describe("AIFS ENS remaining guard branches", () => {
  it("keeps canonical ordering even when a direct internal caller supplies an unknown member", () => {
    expect(sortAifsEnsMembers(["p01", "c00"])).toEqual(["c00", "p01"]);
    expect(sortAifsEnsMembers(["not-a-member", "c00"] as any)).toEqual(["c00", "not-a-member"]);
  });

  it("supports dependency injection through both unified adapters", async () => {
    const query = vi.fn(async () => ({ route: "aifs-ens-query" }));
    const diagnose = vi.fn(async () => ({ route: "aifs-ens-diagnose" }));
    const queryAdapter = new AifsEnsQueryAdapter({ aifsEns: { query } as any });
    const diagnosticAdapter = new AifsEnsDiagnosticAdapter({
      aifsEnsDiagnostics: { diagnose } as any,
    });

    expect(await queryAdapter.query({ dataset: "aifs-ens" } as any)).toEqual({
      route: "aifs-ens-query",
    });
    expect(await diagnosticAdapter.diagnose({ dataset: "aifs-ens" } as any)).toEqual({
      route: "aifs-ens-diagnose",
    });
    expect(query).toHaveBeenCalledOnce();
    expect(diagnose).toHaveBeenCalledOnce();
  });

  it("rejects member grid disagreement before producing an ensemble point", async () => {
    const service = new AifsEnsForecastService({
      memberServiceFactory: (member) => ({
        query: vi.fn(async () => ({
          model: "aifs_0p25",
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
            provider: "ECMWF Open Data",
            access: "indexed_http_range",
            decoder: "gribberish",
            cacheHit: true,
          },
        })),
        diagnose: vi.fn(),
      } as any),
    });

    await expect(service.query(queryAtmosphereSchema.parse({
      dataset: "aifs-ens",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["c00", "p01"], quantiles: [0.5] },
    }))).rejects.toThrow("inconsistent grid points");
  });
});


describe("AIFS ENS default ensemble contract", () => {
  it("uses the full 51-member population and standard quantiles when ensemble controls are omitted", async () => {
    const service = new AifsEnsForecastService({
      memberServiceFactory: () => ({
        query: vi.fn(async () => ({
          model: "aifs_0p25",
          run: "2026-08-30T00:00:00.000Z",
          validTime: "2026-08-30T06:00:00.000Z",
          forecastHour: 6,
          requestedPoint: { latitude: 50.08, longitude: 14.43 },
          gridPoint: { latitude: 50, longitude: 14.5 },
          levels: [{ pressureHpa: 850, temperatureC: 10 }],
          source: {
            provider: "ECMWF Open Data",
            access: "indexed_http_range",
            decoder: "gribberish",
            cacheHit: true,
          },
        })),
        diagnose: vi.fn(),
      } as any),
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "aifs-ens",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    })) as any;

    expect(result.selection.members).toEqual([...AIFS ENS_MEMBERS]);
    expect(result.selection.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(result.pressureSummaries[0].distribution.memberCount).toBe(51);
  });
});


describe("AIFS ENS defensive aggregation coverage", () => {
  const basePointRequest = {
    dataset: "aifs-ens" as const,
    geometry: { type: "point" as const, latitude: 50.08, longitude: 14.43 },
    time: { at: "2026-08-30T06:00:00Z" },
    selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    ensemble: { members: ["c00", "p01"], quantiles: [0.5] },
  };

  it("fails clearly when the run-resolving member returns no run", async () => {
    const service = new AifsEnsForecastService({
      memberServiceFactory: () => ({
        query: vi.fn(async () => ({})),
        diagnose: vi.fn(),
      } as any),
    });
    await expect(service.query(basePointRequest as any))
      .rejects.toThrow("did not return a resolved run");
  });

  it("fails clearly when a member omits a scalar required for aggregation", async () => {
    const service = new AifsEnsForecastService({
      memberServiceFactory: (member) => ({
        query: vi.fn(async () => ({
          run: "2026-08-30T00:00:00.000Z",
          validTime: "2026-08-30T06:00:00.000Z",
          forecastHour: 6,
          requestedPoint: basePointRequest.geometry,
          gridPoint: { latitude: 50, longitude: 14.5 },
          levels: [{
            pressureHpa: 850,
            ...(member === "c00" ? { temperatureC: 10 } : {}),
          }],
          source: { decoder: "gribberish", cacheHit: true },
        })),
        diagnose: vi.fn(),
      } as any),
    });
    await expect(service.query(basePointRequest as any))
      .rejects.toThrow("missing AIFS ENS profile temperatureC@850mb");
  });

  it("rejects a missing sampled grid point before aggregation", async () => {
    const service = new AifsEnsForecastService({
      memberServiceFactory: () => ({
        query: vi.fn(async () => ({
          run: "2026-08-30T00:00:00.000Z",
          validTime: "2026-08-30T06:00:00.000Z",
          forecastHour: 6,
          requestedPoint: basePointRequest.geometry,
          levels: [{ pressureHpa: 850, temperatureC: 10 }],
          source: { decoder: "gribberish", cacheHit: true },
        })),
        diagnose: vi.fn(),
      } as any),
    });
    await expect(service.query(basePointRequest as any))
      .rejects.toThrow("returned no grid point");
  });

  it("rejects unsupported members even for direct internal service callers", async () => {
    const service = new AifsEnsForecastService({
      memberServiceFactory: () => ({
        query: vi.fn(),
        diagnose: vi.fn(),
      } as any),
    });
    await expect(service.query({
      ...basePointRequest,
      ensemble: { members: ["c00", "bad-member"], quantiles: [0.5] },
    } as any)).rejects.toThrow("unsupported: bad-member");
  });

  it("requires member extrema when extrema locations are requested", async () => {
    const service = new AifsEnsForecastService({
      memberServiceFactory: () => ({
        query: vi.fn(async () => ({
          run: "2026-08-30T00:00:00.000Z",
          validTime: "2026-08-30T06:00:00.000Z",
          forecastHour: 6,
          bbox: {
            westLongitude: 14,
            eastLongitude: 14.5,
            southLatitude: 49,
            northLatitude: 49.5,
          },
          variable: {
            id: "temperature",
            pressureHpa: 850,
            field: "temperatureC",
            unit: "degC",
          },
          statistics: {
            definedGridPoints: 4,
            mean: 10,
            min: 8,
            max: 12,
          },
          distribution: {},
          source: { decoder: "gribberish", cacheHit: true },
        })),
        diagnose: vi.fn(),
      } as any),
    });

    await expect(service.query({
      dataset: "aifs-ens",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49,
        northLatitude: 49.5,
      },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["c00", "p01"], quantiles: [0.5] },
      aggregate: { includeExtremaLocations: true },
    } as any)).rejects.toThrow("missing AIFS ENS member extrema");
  });
});

