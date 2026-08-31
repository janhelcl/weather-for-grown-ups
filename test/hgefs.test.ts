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
