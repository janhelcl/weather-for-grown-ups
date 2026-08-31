import { describe, expect, it, vi } from "vitest";
import {
  HGEFS_MEMBERS,
  splitHgefsMembers,
} from "../src/catalog/hgefs.js";
import { ATMOSPHERIC_DATASET_CATALOG } from "../src/catalog/models.js";
import { HgefsForecastService } from "../src/core/hgefs.js";
import {
  diagnoseAtmosphereSchema,
  publicDatasetCapabilities,
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";

const run = "2026-08-31T00:00:00.000Z";
const validTime = "2026-08-31T06:00:00.000Z";
const requestedPoint = { latitude: 50.08, longitude: 14.43 };
const aiGridPoint = { latitude: 50, longitude: 14.5 };
const physicsGridPoint = { latitude: 50, longitude: 14 };

const selectedMembers = [
  "gefs:c00",
  "gefs:p01",
  "aigefs:c00",
  "aigefs:p01",
] as const;

describe("HGEFS hybrid catalog and validation", () => {
  it("registers the operational 31+31 hybrid population without flattening model class", () => {
    expect(HGEFS_MEMBERS).toHaveLength(62);
    expect(splitHgefsMembers(undefined)).toMatchObject({
      gefs: expect.arrayContaining(["c00", "p30"]),
      aigefs: expect.arrayContaining(["c00", "p30"]),
    });
    expect(ATMOSPHERIC_DATASET_CATALOG.hgefs_0p25).toMatchObject({
      family: "hgefs",
      provider: "noaa",
      modelClass: "hybrid",
      kind: "ensemble",
      horizontalGridDegrees: 0.25,
      maxForecastHour: 240,
      nativeForecastIntervalHours: 6,
      members: 62,
    });
    expect(publicDatasetCapabilities("hgefs")).toMatchObject({
      dataset: "hgefs",
      modelClass: "hybrid",
      kind: "ensemble",
      operations: [
        "profile",
        "timeseries",
        "layer_diagnostics",
        "profile_diagnostics",
        "ensemble_distribution",
      ],
    });
  });

  it("requires namespaced members from both populations and only common inventory", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      ensemble: { members: ["c00", "p01", "p02", "p03"] },
    })).toThrow("HGEFS members are namespaced");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      ensemble: {
        members: ["gefs:c00", "gefs:p01", "gefs:p02", "aigefs:c00"],
      },
    })).toThrow("at least two GEFS and two AIGEFS members");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      selection: {
        variables: ["relative_humidity"],
        pressureLevelsHpa: [850],
      },
      ensemble: { members: selectedMembers },
    })).toThrow("compatible semantics in both GEFS and AIGEFS");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: {
        type: "points",
        points: [requestedPoint, { latitude: 49.2, longitude: 16.61 }],
      },
      time: { at: validTime },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      ensemble: { members: selectedMembers },
    })).toThrow("currently supports point geometry only");
  });

  it("keeps diagnostic time ranges and parcels as explicit capability boundaries", () => {
    expect(() => diagnoseAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: {
        from: validTime,
        to: "2026-08-31T12:00:00Z",
      },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      ensemble: { members: selectedMembers },
    })).toThrow("diagnostic time series are not exposed");

    expect(() => diagnoseAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850],
        parcel: "surface_2m",
      },
      ensemble: { members: selectedMembers },
    })).toThrow("AIGEFS constituent lacks");
  });
});

describe("HGEFS member-first composition", () => {
  it("pools GEFS and AIGEFS members exactly while preserving constituent grids", async () => {
    const aigefs = {
      query: vi.fn(async () => ({
        model: "aigefs_0p25",
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: aiGridPoint,
        members: [
          { member: "c00", cacheHit: true, levels: [{ pressureHpa: 850, temperatureC: 10 }] },
          { member: "p01", cacheHit: true, levels: [{ pressureHpa: 850, temperatureC: 12 }] },
        ],
        source: {
          provider: "NOAA EAGLE AWS Open Data",
          access: "s3_range",
          decoder: "gribberish",
          horizontalGridDegrees: 0.25,
          memberCount: 2,
          allCacheHit: true,
        },
      })),
      diagnose: vi.fn(),
    };
    const gefsBundle = {
      getBundle: vi.fn(async () => ({
        model: "gefs_0p50",
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: physicsGridPoint,
        members: [
          {
            member: "c00",
            cacheHit: true,
            pressureValues: [{ variable: "temperature", pressureLevelHpa: 850, value: 14 }],
            fields: [],
          },
          {
            member: "p01",
            cacheHit: true,
            pressureValues: [{ variable: "temperature", pressureLevelHpa: 850, value: 16 }],
            fields: [],
          },
        ],
        source: {
          provider: "NOAA AWS Open Data",
          access: "s3_range",
          decoder: "gribberish",
          product: "pgrb2a_0p50",
          horizontalGridDegrees: 0.5,
          allCacheHit: true,
        },
      })),
    };

    const service = new HgefsForecastService({
      aigefs: aigefs as any,
      gefsBundle: gefsBundle as any,
    });
    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      ensemble: {
        members: selectedMembers,
        quantiles: [0.5],
        includeMembers: true,
      },
    })) as any;

    expect(result.model).toBe("hgefs_0p25");
    expect(result.selection.members).toEqual(selectedMembers);
    expect(result.pressureSummaries[0].distribution).toMatchObject({
      memberCount: 4,
      mean: 13,
      min: 10,
      max: 16,
      quantiles: [{ quantile: 0.5, value: 13 }],
    });
    expect(result.gridPoints).toEqual({
      gefs: physicsGridPoint,
      aigefs: aiGridPoint,
    });
    expect(result.composition).toMatchObject({
      kind: "hybrid",
      totalMemberCount: 4,
      populations: [
        {
          id: "gefs",
          modelClass: "physics",
          nativeModel: "gefs_0p50",
          memberCount: 2,
          horizontalGridDegrees: 0.5,
        },
        {
          id: "aigefs",
          modelClass: "ai",
          nativeModel: "aigefs_0p25",
          memberCount: 2,
          horizontalGridDegrees: 0.25,
        },
      ],
    });
    expect(result.members.map((member: any) => member.member)).toEqual(selectedMembers);
    expect(result.source).toMatchObject({
      provider: "NOAA",
      access: "constituent_open_data_composition",
      methodology: "member_first_gefs_plus_aigefs",
      allCacheHit: true,
    });

    expect(aigefs.query).toHaveBeenCalledWith(expect.objectContaining({
      dataset: "aigefs",
      ensemble: expect.objectContaining({
        members: ["c00", "p01"],
        includeMembers: true,
      }),
    }));
    expect(gefsBundle.getBundle).toHaveBeenCalledWith(expect.objectContaining({
      run,
      members: ["c00", "p01"],
      includeMembers: true,
    }));
  });

  it("uses the AIGEFS 6-hour cadence while matching corresponding GEFS steps", async () => {
    const aigefs = {
      query: vi.fn(async () => ({
        model: "aigefs_0p25",
        run,
        requestedStartTime: validTime,
        requestedEndTime: "2026-08-31T12:00:00.000Z",
        requestedPoint,
        gridPoint: aiGridPoint,
        series: [
          { validTime, forecastHour: 6 },
          { validTime: "2026-08-31T12:00:00.000Z", forecastHour: 12 },
        ],
        members: [
          {
            member: "c00",
            series: [
              { validTime, forecastHour: 6, levels: [{ pressureHpa: 850, temperatureC: 10 }], cacheHit: true },
              { validTime: "2026-08-31T12:00:00.000Z", forecastHour: 12, levels: [{ pressureHpa: 850, temperatureC: 11 }], cacheHit: true },
            ],
          },
          {
            member: "p01",
            series: [
              { validTime, forecastHour: 6, levels: [{ pressureHpa: 850, temperatureC: 12 }], cacheHit: true },
              { validTime: "2026-08-31T12:00:00.000Z", forecastHour: 12, levels: [{ pressureHpa: 850, temperatureC: 13 }], cacheHit: true },
            ],
          },
        ],
        source: { horizontalGridDegrees: 0.25, allCacheHit: true },
      })),
      diagnose: vi.fn(),
    };
    const gefsTimeSeries = {
      getTimeSeries: vi.fn(async () => ({
        model: "gefs_0p50",
        run,
        requestedPoint,
        gridPoint: physicsGridPoint,
        series: [
          {
            validTime,
            forecastHour: 6,
            members: [
              { member: "c00", cacheHit: true, pressureValues: [{ variable: "temperature", pressureLevelHpa: 850, value: 14 }], fields: [] },
              { member: "p01", cacheHit: true, pressureValues: [{ variable: "temperature", pressureLevelHpa: 850, value: 16 }], fields: [] },
            ],
          },
          {
            validTime: "2026-08-31T09:00:00.000Z",
            forecastHour: 9,
            members: [],
          },
          {
            validTime: "2026-08-31T12:00:00.000Z",
            forecastHour: 12,
            members: [
              { member: "c00", cacheHit: true, pressureValues: [{ variable: "temperature", pressureLevelHpa: 850, value: 15 }], fields: [] },
              { member: "p01", cacheHit: true, pressureValues: [{ variable: "temperature", pressureLevelHpa: 850, value: 17 }], fields: [] },
            ],
          },
        ],
        source: { horizontalGridDegrees: 0.5, allCacheHit: true },
      })),
    };

    const service = new HgefsForecastService({
      aigefs: aigefs as any,
      gefsTimeSeries: gefsTimeSeries as any,
    });
    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: {
        from: validTime,
        to: "2026-08-31T12:00:00Z",
      },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      ensemble: {
        members: selectedMembers,
        quantiles: [0.5],
      },
    })) as any;

    expect(result.stepHours).toBe(6);
    expect(result.series).toHaveLength(2);
    expect(result.series.map((step: any) => step.forecastHour)).toEqual([6, 12]);
    expect(result.series.map((step: any) => step.pressureSummaries[0].distribution.mean))
      .toEqual([13, 14]);
    expect(gefsTimeSeries.getTimeSeries).toHaveBeenCalledWith(
      expect.objectContaining({ run, includeMembers: true, maxSteps: 81 }),
    );
  });

  it("derives nonlinear layer diagnostics inside each constituent member before hybrid aggregation", async () => {
    const aigefs = {
      query: vi.fn(),
      diagnose: vi.fn(async () => ({
        model: "aigefs_0p25",
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: aiGridPoint,
        members: [
          {
            member: "c00",
            cacheHit: true,
            layer: { depthGpm: 1500 },
            diagnostics: [{ id: "temperature_lapse_rate", values: { temperatureLapseRateCPerKm: 6 } }],
          },
          {
            member: "p01",
            cacheHit: true,
            layer: { depthGpm: 1600 },
            diagnostics: [{ id: "temperature_lapse_rate", values: { temperatureLapseRateCPerKm: 8 } }],
          },
        ],
        source: { horizontalGridDegrees: 0.25, allCacheHit: true },
      })),
    };
    const gefsLayerDiagnostics = {
      getLayerDiagnostics: vi.fn(async () => ({
        model: "gefs_0p50",
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: physicsGridPoint,
        members: [
          {
            member: "c00",
            cacheHit: true,
            layer: { depthGpm: 1700 },
            diagnostics: [{ id: "temperature_lapse_rate", values: { temperatureLapseRateCPerKm: 10 } }],
          },
          {
            member: "p01",
            cacheHit: true,
            layer: { depthGpm: 1800 },
            diagnostics: [{ id: "temperature_lapse_rate", values: { temperatureLapseRateCPerKm: 12 } }],
          },
        ],
        source: { allCacheHit: true },
      })),
    };

    const service = new HgefsForecastService({
      aigefs: aigefs as any,
      gefsLayerDiagnostics: gefsLayerDiagnostics as any,
    });
    const result = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      ensemble: {
        members: selectedMembers,
        quantiles: [0.5],
        includeMembers: true,
      },
    })) as any;

    expect(result.layerDepthGpm.mean).toBe(1650);
    expect(result.summaries[0].distribution).toMatchObject({
      memberCount: 4,
      mean: 9,
      quantiles: [{ quantile: 0.5, value: 9 }],
    });
    expect(result.members.map((member: any) => member.member)).toEqual(selectedMembers);
  });
});


describe("HGEFS field and invariant coverage", () => {
  it("aggregates common scalar and circular fields without returning members by default", async () => {
    const temporal = { type: "instantaneous" as const };
    const aigefs = {
      query: vi.fn(async () => ({
        model: "aigefs_0p25",
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: aiGridPoint,
        members: [
          {
            member: "c00",
            cacheHit: false,
            levels: [],
            fields: [{
              id: "wind_10m",
              temporal,
              values: { windSpeedMs: 4, windDirectionDeg: 350 },
            }],
          },
          {
            member: "p01",
            cacheHit: true,
            levels: [],
            fields: [{
              id: "wind_10m",
              temporal,
              values: { windSpeedMs: 6, windDirectionDeg: 10 },
            }],
          },
        ],
        source: { horizontalGridDegrees: 0.25, allCacheHit: false },
      })),
      diagnose: vi.fn(),
    };
    const gefsBundle = {
      getBundle: vi.fn(async () => ({
        model: "gefs_0p50",
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: physicsGridPoint,
        members: [
          {
            member: "c00",
            cacheHit: true,
            pressureValues: [],
            fields: [{
              field: "wind_10m",
              temporal,
              values: { windSpeedMs: 8, windDirectionDeg: 0 },
            }],
          },
          {
            member: "p01",
            cacheHit: true,
            pressureValues: [],
            fields: [{
              field: "wind_10m",
              temporal,
              values: { windSpeedMs: 10, windDirectionDeg: 20 },
            }],
          },
        ],
        source: {
          horizontalGridDegrees: 0.25,
          allCacheHit: true,
        },
      })),
    };
    const service = new HgefsForecastService({
      aigefs: aigefs as any,
      gefsBundle: gefsBundle as any,
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      selection: { fields: ["wind_10m"] },
      forecast: { run },
      ensemble: {
        members: selectedMembers,
        quantiles: [0.25, 0.5, 0.75],
        maxMemberSamples: 100,
      },
    })) as any;

    expect(result.pressureSummaries).toEqual([]);
    expect(result.members).toBeUndefined();
    expect(result.fieldSummaries[0].outputs).toEqual([
      expect.objectContaining({
        field: "windSpeedMs",
        aggregation: "numeric_distribution",
        distribution: expect.objectContaining({ memberCount: 4, mean: 7 }),
      }),
      expect.objectContaining({
        field: "windDirectionDeg",
        aggregation: "circular_direction",
        memberCount: 4,
      }),
    ]);
    expect(result.source.allCacheHit).toBe(false);
    expect(aigefs.query).toHaveBeenCalledWith(expect.objectContaining({
      forecast: expect.objectContaining({ run }),
      ensemble: expect.objectContaining({ maxMemberSamples: 100 }),
    }));
  });

  it("rejects constituent temporal disagreement instead of averaging unlike field intervals", async () => {
    const aigefs = {
      query: vi.fn(async () => ({
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: aiGridPoint,
        members: [
          {
            member: "c00",
            levels: [],
            fields: [{
              id: "total_precipitation",
              temporal: { type: "accumulation", startForecastHour: 0, endForecastHour: 6, startTime: run, endTime: validTime },
              values: { totalPrecipitationMm: 1 },
            }],
          },
          {
            member: "p01",
            levels: [],
            fields: [{
              id: "total_precipitation",
              temporal: { type: "accumulation", startForecastHour: 0, endForecastHour: 6, startTime: run, endTime: validTime },
              values: { totalPrecipitationMm: 2 },
            }],
          },
        ],
        source: { allCacheHit: true },
      })),
      diagnose: vi.fn(),
    };
    const gefsBundle = {
      getBundle: vi.fn(async () => ({
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: physicsGridPoint,
        members: [
          {
            member: "c00",
            pressureValues: [],
            fields: [{
              field: "total_precipitation",
              temporal: { type: "accumulation", startForecastHour: 3, endForecastHour: 6, startTime: "2026-08-31T03:00:00.000Z", endTime: validTime },
              values: { totalPrecipitationMm: 3 },
            }],
          },
          {
            member: "p01",
            pressureValues: [],
            fields: [{
              field: "total_precipitation",
              temporal: { type: "accumulation", startForecastHour: 3, endForecastHour: 6, startTime: "2026-08-31T03:00:00.000Z", endTime: validTime },
              values: { totalPrecipitationMm: 4 },
            }],
          },
        ],
        source: { allCacheHit: true },
      })),
    };
    const service = new HgefsForecastService({
      aigefs: aigefs as any,
      gefsBundle: gefsBundle as any,
    });

    await expect(service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      selection: { fields: ["total_precipitation"] },
      ensemble: { members: selectedMembers },
    }))).rejects.toThrow("temporal semantics disagree");
  });

  it("combines profile diagnostic structures member-first", async () => {
    const diag = (height: number | undefined) => ({
      id: "freezing_level_crossings",
      crossings: height === undefined
        ? []
        : [{ geopotentialHeightGpm: height, pressureHpa: 900 }],
    });
    const aigefs = {
      query: vi.fn(),
      diagnose: vi.fn(async () => ({
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: aiGridPoint,
        sampledPressureLevelsHpa: [1000, 850],
        members: [
          { member: "c00", cacheHit: true, levels: [], diagnostics: [diag(1000)] },
          { member: "p01", cacheHit: true, levels: [], diagnostics: [diag(undefined)] },
        ],
        source: { horizontalGridDegrees: 0.25, allCacheHit: true },
      })),
    };
    const gefsProfileDiagnostics = {
      getProfileDiagnostics: vi.fn(async () => ({
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: physicsGridPoint,
        sampledPressureLevelsHpa: [1000, 850],
        members: [
          { member: "c00", cacheHit: true, levels: [], diagnostics: [diag(1200)] },
          { member: "p01", cacheHit: true, levels: [], diagnostics: [diag(1400)] },
        ],
        source: { allCacheHit: true },
      })),
    };
    const service = new HgefsForecastService({
      aigefs: aigefs as any,
      gefsProfileDiagnostics: gefsProfileDiagnostics as any,
    });

    const result = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 850],
        diagnostics: ["freezing_level_crossings"],
      },
      ensemble: {
        members: selectedMembers,
        quantiles: [0.5],
      },
    })) as any;

    expect(result.members).toBeUndefined();
    expect(result.summaries[0].membersWithAnyCrossing).toEqual({
      count: 3,
      memberCount: 4,
      fraction: 0.75,
      interpretation: "raw_member_fraction_not_calibrated_probability",
    });
    expect(result.summaries[0].crossingCount.mean).toBe(0.75);
    expect(result.summaries[0].lowestCrossing.contributingMemberCount).toBe(3);
  });

  it("enforces the f240 horizon and constituent alignment in the service boundary", async () => {
    const lateAigefs = {
      query: vi.fn(async () => ({
        run,
        validTime: "2026-09-10T06:00:00.000Z",
        forecastHour: 246,
      })),
      diagnose: vi.fn(),
    };
    const lateService = new HgefsForecastService({ aigefs: lateAigefs as any });
    await expect(lateService.query({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: "2026-09-10T06:00:00.000Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: [...selectedMembers] },
    } as any)).rejects.toThrow("f000 through f240");

    const alignedAigefs = {
      query: vi.fn(async () => ({
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: aiGridPoint,
        members: [
          { member: "c00", levels: [{ pressureHpa: 850, temperatureC: 10 }] },
          { member: "p01", levels: [{ pressureHpa: 850, temperatureC: 12 }] },
        ],
        source: { allCacheHit: true },
      })),
      diagnose: vi.fn(),
    };
    const wrongRunGefs = {
      getBundle: vi.fn(async () => ({
        run: "2026-08-30T18:00:00.000Z",
        validTime,
        forecastHour: 12,
        requestedPoint,
        gridPoint: physicsGridPoint,
        members: [],
        source: { allCacheHit: true },
      })),
    };
    const alignmentService = new HgefsForecastService({
      aigefs: alignedAigefs as any,
      gefsBundle: wrongRunGefs as any,
    });
    await expect(alignmentService.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: selectedMembers },
    }))).rejects.toThrow("different runs");
  });

  it("keeps service-level dataset and diagnostic boundaries explicit even for prevalidated callers", async () => {
    const service = new HgefsForecastService();
    await expect(service.query({ dataset: "gefs" } as any))
      .rejects.toThrow("only accepts dataset=hgefs");
    await expect(service.query({
      dataset: "hgefs",
      geometry: { type: "area" },
    } as any)).rejects.toThrow("point and point time-range queries only");
    await expect(service.diagnose({ dataset: "gefs" } as any))
      .rejects.toThrow("only accepts dataset=hgefs");
    await expect(service.diagnose({
      dataset: "hgefs",
      time: { from: validTime, to: validTime },
    } as any)).rejects.toThrow("diagnostic time series are not exposed");
    await expect(service.diagnose({
      dataset: "hgefs",
      time: { at: validTime },
      diagnostic: { kind: "parcel" },
    } as any)).rejects.toThrow("parcel diagnostics");
  });
});


describe("HGEFS malformed constituent invariants", () => {
  it("rejects a constituent result without a resolved run", async () => {
    const service = new HgefsForecastService({
      aigefs: {
        query: vi.fn(async () => ({
          validTime,
          forecastHour: 6,
        })),
        diagnose: vi.fn(),
      } as any,
    });

    await expect(service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: selectedMembers },
    }))).rejects.toThrow("did not return a resolved run");
  });

  it("rejects a constituent that omits the raw member payload required for exact hybrid aggregation", async () => {
    const aigefs = {
      query: vi.fn(async () => ({
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: aiGridPoint,
        source: { allCacheHit: true },
      })),
      diagnose: vi.fn(),
    };
    const gefsBundle = {
      getBundle: vi.fn(async () => ({
        run,
        validTime,
        forecastHour: 6,
        requestedPoint,
        gridPoint: physicsGridPoint,
        members: [
          { member: "c00", pressureValues: [], fields: [] },
          { member: "p01", pressureValues: [], fields: [] },
        ],
        source: { allCacheHit: true },
      })),
    };
    const service = new HgefsForecastService({
      aigefs: aigefs as any,
      gefsBundle: gefsBundle as any,
    });

    await expect(service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: { type: "point", ...requestedPoint },
      time: { at: validTime },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: selectedMembers },
    }))).rejects.toThrow("HGEFS AIGEFS raw members is missing an expected member array");
  });
});
