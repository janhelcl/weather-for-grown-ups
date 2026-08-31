import { describe, expect, it, vi } from "vitest";
import {
  AIGEFS_MEMBERS,
  aigefsSourceMember,
} from "../src/catalog/aigefs.js";
import { ATMOSPHERIC_DATASET_CATALOG } from "../src/catalog/models.js";
import { AigefsForecastService } from "../src/core/aigefs.js";
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
    expect(result.pressureSummaries.find((summary: any) =>
      summary.field === "windDirectionDeg",
    )).toMatchObject({
      aggregation: "circular_direction",
      memberCount: 2,
      meanDirectionDeg: 0,
    });
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
              temperatureDifferenceC: member === "c00" ? 10 : 12,
              lapseRateCPerKm: member === "c00" ? 6 : 8,
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
      summary.field === "lapseRateCPerKm",
    ).distribution.mean).toBe(7);
  });
});
