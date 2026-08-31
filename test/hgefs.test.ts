import { describe, expect, it, vi } from "vitest";
import { ATMOSPHERIC_DATASET_CATALOG } from "../src/catalog/models.js";
import { HGEFS_MEMBERS } from "../src/catalog/hgefs.js";
import { HgefsForecastService } from "../src/core/hgefs.js";
import {
  diagnoseAtmosphereSchema,
  publicDatasetCapabilities,
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";

const run = "2026-08-31T00:00:00.000Z";
const validTime = "2026-08-31T06:00:00.000Z";
const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

describe("HGEFS hybrid catalog and validation", () => {
  it("registers the operational 62-member physics plus AI composition explicitly", () => {
    expect(HGEFS_MEMBERS).toHaveLength(62);
    expect(HGEFS_MEMBERS[0]).toBe("gefs:c00");
    expect(HGEFS_MEMBERS[30]).toBe("gefs:p30");
    expect(HGEFS_MEMBERS[31]).toBe("aigefs:c00");
    expect(HGEFS_MEMBERS[61]).toBe("aigefs:p30");

    expect(ATMOSPHERIC_DATASET_CATALOG.hgefs_0p25).toMatchObject({
      family: "hgefs",
      provider: "noaa",
      modelClass: "hybrid",
      kind: "ensemble",
      members: 62,
      maxForecastHour: 240,
      nativeForecastIntervalHours: 6,
      constituents: [
        { dataset: "gefs_0p50", modelClass: "physics", members: 31 },
        { dataset: "aigefs_0p25", modelClass: "ai", members: 31 },
      ],
    });

    expect(publicDatasetCapabilities("hgefs")).toMatchObject({
      dataset: "hgefs",
      provider: "noaa",
      modelClass: "hybrid",
      kind: "ensemble",
      maxForecastHour: 240,
      nativeForecastIntervalHours: 6,
      runSelectors: ["latest", "explicit"],
      constituents: [
        { dataset: "gefs_0p50", modelClass: "physics", members: 31 },
        { dataset: "aigefs_0p25", modelClass: "ai", members: 31 },
      ],
    });
  });

  it("enforces HGEFS geometry guardrails at the public schema boundary", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: {
        type: "points",
        points: Array.from({ length: 21 }, (_, index) => ({
          latitude: 49 + index * 0.01,
          longitude: 14,
        })),
      },
      time: { at: validTime },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["gefs:c00", "aigefs:c00"] },
    })).toThrow("at most 20 points");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: {
        type: "transect",
        start: { latitude: 50, longitude: 14 },
        end: { latitude: 49, longitude: 15 },
        samples: 21,
      },
      time: { at: validTime },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["gefs:c00", "aigefs:c00"] },
    })).toThrow("at most 20 samples");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: {
        type: "area",
        westLongitude: 13,
        eastLongitude: 15,
        southLatitude: 49,
        northLatitude: 51,
      },
      time: { at: validTime },
      selection: { variables: ["wind"], pressureLevelsHpa: [850] },
      ensemble: { members: ["gefs:c00", "aigefs:c00"] },
    })).toThrow("HGEFS area pressure summaries require variables available as native scalar fields");
  });

  it("requires population-qualified members and the real constituent inventory intersection", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: { at: validTime },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["c00", "p01"] },
    })).toThrow("HGEFS members use population-qualified IDs");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: { at: validTime },
      selection: { variables: ["specific_humidity"], pressureLevelsHpa: [300] },
      ensemble: { members: ["gefs:c00", "aigefs:c00"] },
    })).toThrow("HGEFS constituent member intersection cannot satisfy");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: { at: validTime },
      selection: { variables: ["vertical_velocity"], pressureLevelsHpa: [700] },
      ensemble: { members: ["gefs:c00", "aigefs:c00"] },
    })).toThrow("HGEFS constituent member intersection cannot satisfy");

    expect(() => diagnoseAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: { at: validTime },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850],
        parcel: "surface_2m",
      },
      ensemble: { members: ["gefs:c00", "aigefs:c00"] },
    })).toThrow("HGEFS parcel diagnostics are not exposed");
  });
});

describe("HGEFS member-first constituent composition", () => {
  it("pools selected GEFS and AIGEFS members while preserving native grids and population identity", async () => {
    const aigefsQuery = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime,
      forecastHour: 6,
      requestedPoint: point,
      gridPoint: { latitude: 50, longitude: 14.5 },
      members: request.ensemble.members.map((member: string) => ({
        member,
        cacheHit: true,
        levels: [{
          pressureHpa: 850,
          temperatureC: member === "c00" ? 10 : 99,
        }],
      })),
      source: {
        provider: "NOAA EAGLE AWS Open Data",
        access: "s3_range",
        horizontalGridDegrees: 0.25,
        allCacheHit: true,
      },
    }));

    const gefsQuery = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime,
      forecastHour: 6,
      requestedPoint: point,
      gridPoint: { latitude: 50, longitude: 14 },
      members: request.ensemble.members.map((member: string) => ({
        member,
        cacheHit: true,
        pressureValues: [{
          variable: "temperature",
          pressureLevelHpa: 850,
          value: member === "p01" ? 12 : 77,
        }],
        fields: [],
      })),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        product: "pgrb2a_0p50",
        horizontalGridDegrees: 0.5,
        allCacheHit: true,
      },
    }));

    const service = new HgefsForecastService({
      aigefs: { query: aigefsQuery, diagnose: vi.fn() } as any,
      gefsQuery: { query: gefsQuery },
      gefsDiagnostics: { diagnose: vi.fn() },
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: { at: validTime },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run },
      ensemble: {
        members: ["gefs:p01", "aigefs:c00"],
        quantiles: [0.5],
        includeMembers: true,
      },
    })) as any;

    expect(result.model).toBe("hgefs_0p25");
    expect(result.selection.members).toEqual(["gefs:p01", "aigefs:c00"]);
    expect(result.selection.populations).toEqual([
      { population: "gefs", modelClass: "physics", selectedMemberCount: 1 },
      { population: "aigefs", modelClass: "ai", selectedMemberCount: 1 },
    ]);
    expect(result.pressureSummaries[0]).toMatchObject({
      pressureLevelHpa: 850,
      field: "temperatureC",
      distribution: {
        memberCount: 2,
        mean: 11,
        min: 10,
        max: 12,
        quantiles: [{ quantile: 0.5, value: 11 }],
      },
    });
    expect(result.constituentGridPoints).toEqual([
      {
        population: "gefs",
        modelClass: "physics",
        gridPoint: { latitude: 50, longitude: 14 },
      },
      {
        population: "aigefs",
        modelClass: "ai",
        gridPoint: { latitude: 50, longitude: 14.5 },
      },
    ]);
    expect(result.members).toEqual(expect.arrayContaining([
      expect.objectContaining({
        member: "gefs:p01",
        population: "gefs",
        modelClass: "physics",
        gridPoint: { latitude: 50, longitude: 14 },
      }),
      expect.objectContaining({
        member: "aigefs:c00",
        population: "aigefs",
        modelClass: "ai",
        gridPoint: { latitude: 50, longitude: 14.5 },
      }),
    ]));
    expect(result.source).toMatchObject({
      provider: "NOAA",
      access: "constituent_member_feeds",
      methodology: "member_first_constituent_composition",
      memberCount: 2,
      allCacheHit: true,
    });

    expect(aigefsQuery).toHaveBeenCalledWith(expect.objectContaining({
      dataset: "aigefs",
      forecast: { run },
      ensemble: expect.objectContaining({
        members: ["c00", "p01"],
        includeMembers: true,
      }),
    }));
    expect(gefsQuery).toHaveBeenCalledWith(expect.objectContaining({
      dataset: "gefs",
      forecast: { run },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: undefined,
      },
      ensemble: expect.objectContaining({
        members: ["p01", "c00"],
        includeMembers: true,
      }),
    }));
  });

  it("derives and aggregates diagnostics inside each constituent member before hybrid aggregation", async () => {
    const aigefsDiagnose = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime,
      forecastHour: 6,
      requestedPoint: point,
      gridPoint: { latitude: 50, longitude: 14.5 },
      members: request.ensemble.members.map((member: string) => ({
        member,
        cacheHit: true,
        layer: {
          lowerPressureHpa: 850,
          upperPressureHpa: 700,
          lowerGeopotentialHeightGpm: 1500,
          upperGeopotentialHeightGpm: 3000,
          depthGpm: 1500,
        },
        diagnostics: [{
          id: "temperature_lapse_rate",
          values: { temperatureLapseRateCPerKm: member === "c00" ? 6 : 99 },
        }],
      })),
      source: { allCacheHit: true },
    }));
    const gefsDiagnose = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime,
      forecastHour: 6,
      requestedPoint: point,
      gridPoint: { latitude: 50, longitude: 14 },
      members: request.ensemble.members.map((member: string) => ({
        member,
        cacheHit: true,
        layer: {
          lowerPressureHpa: 850,
          upperPressureHpa: 700,
          lowerGeopotentialHeightGpm: 1500,
          upperGeopotentialHeightGpm: 3200,
          depthGpm: 1700,
        },
        diagnostics: [{
          id: "temperature_lapse_rate",
          values: { temperatureLapseRateCPerKm: member === "p01" ? 8 : 88 },
        }],
      })),
      source: { allCacheHit: true },
    }));

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
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      forecast: { run },
      ensemble: {
        members: ["gefs:p01", "aigefs:c00"],
        quantiles: [0.5],
        includeMembers: true,
      },
    })) as any;

    expect(result.layerDepthGpm).toMatchObject({
      memberCount: 2,
      mean: 1600,
      min: 1500,
      max: 1700,
    });
    expect(result.summaries.find((summary: any) =>
      summary.field === "temperatureLapseRateCPerKm",
    ).distribution.mean).toBe(7);
    expect(result.members.map((member: any) => member.member)).toEqual([
      "gefs:p01",
      "aigefs:c00",
    ]);
  });

  it("enforces the native 240-hour HGEFS horizon before constituent access", async () => {
    const aigefsQuery = vi.fn();
    const gefsQuery = vi.fn();
    const service = new HgefsForecastService({
      aigefs: { query: aigefsQuery, diagnose: vi.fn() } as any,
      gefsQuery: { query: gefsQuery },
      gefsDiagnostics: { diagnose: vi.fn() },
    });

    await expect(service.query(queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: { at: "2026-09-10T06:00:00.000Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run },
      ensemble: { members: ["gefs:p01", "aigefs:c00"] },
    }))).rejects.toThrow("HGEFS forecast hour must be at most 240");

    expect(aigefsQuery).not.toHaveBeenCalled();
    expect(gefsQuery).not.toHaveBeenCalled();
  });
});
