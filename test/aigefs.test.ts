import { describe, expect, it, vi } from "vitest";
import { AigefsForecastService } from "../src/core/aigefs.js";
import {
  diagnoseAtmosphereSchema,
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";
import {
  aigefsMemberNomadsPaths,
  buildAigefsNomadsUrl,
  buildAigefsStatisticNomadsUrl,
} from "../src/sources/aigfs.js";

const run = new Date("2026-08-30T00:00:00Z");
const runProvider = {
  resolveLatestRun: vi.fn(async () => run),
  resolveLatestCompleteRun: vi.fn(async () => run),
};

function pointResult(member: string) {
  const offset = Number(member);
  return {
    model: "aigfs_0p25",
    run: run.toISOString(),
    validTime: "2026-08-30T06:00:00.000Z",
    forecastHour: 6,
    requestedPoint: { latitude: 50, longitude: 14 },
    gridPoint: { latitude: 50, longitude: 14 },
    levels: [{
      pressureHpa: 850,
      temperatureC: 10 + offset,
      windSpeedMs: 5 + offset,
      windDirectionDeg: member === "000" ? 350 : 10,
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
      decoder: "wgrib2",
      cacheHit: member === "000",
    },
  };
}

function areaResult(member: string) {
  const offset = Number(member);
  return {
    model: "aigfs_0p25",
    run: run.toISOString(),
    validTime: "2026-08-30T06:00:00.000Z",
    forecastHour: 6,
    bbox: {
      westLongitude: 14,
      eastLongitude: 14.5,
      southLatitude: 49.5,
      northLatitude: 50,
    },
    variable: {
      id: "temperature",
      pressureHpa: 850,
      field: "temperatureC",
      unit: "degC",
    },
    statistics: {
      definedGridPoints: 9,
      mean: 10 + offset,
      min: 5 + offset,
      max: 15 + offset,
      meanKind: "unweighted_grid_point_mean",
    },
    distribution: {
      percentiles: [{ percentile: 50, value: 10 + offset }],
      thresholdFractions: [{
        operator: "gte",
        threshold: 10,
        count: offset === 0 ? 4 : 6,
        fraction: offset === 0 ? 4 / 9 : 6 / 9,
      }],
      extrema: {
        min: { value: 5 + offset, gridPoint: { latitude: 49.5, longitude: 14 } },
        max: { value: 15 + offset, gridPoint: { latitude: 50, longitude: 14.5 } },
      },
    },
    source: {
      provider: "NOAA NOMADS",
      access: "nomads_range",
      decoder: "wgrib2",
      cacheHit: true,
    },
  };
}

describe("AIGEFS member-first service", () => {
  it("aggregates pressure and field values only after member-level derivation", async () => {
    const service = new AigefsForecastService({
      runProvider,
      memberServiceFactory: (member) => ({
        query: vi.fn(async () => pointResult(member)),
        diagnose: vi.fn(),
      }) as any,
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: {
        variables: ["temperature", "wind"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m"],
      },
      ensemble: {
        members: ["000", "001"],
        quantiles: [0, 0.5, 1],
        includeMembers: true,
      },
    })) as any;

    expect(result.model).toBe("aigefs_0p25");
    expect(result.selection.members).toEqual(["000", "001"]);
    expect(result.pressureSummaries.find((item: any) =>
      item.variable === "temperature").distribution).toMatchObject({
      memberCount: 2,
      mean: 10.5,
      min: 10,
      max: 11,
    });
    const direction = result.pressureSummaries.find((item: any) =>
      item.field === "windDirectionDeg");
    expect(direction.aggregation).toBe("circular_direction");
    expect(direction.meanDirectionDeg === 0 || direction.meanDirectionDeg === 360).toBe(true);
    expect(result.fieldSummaries[0].outputs[0].distribution.mean).toBe(12.5);
    expect(result.members).toHaveLength(2);
    expect(result.source).toMatchObject({
      provider: "NOAA NOMADS",
      horizontalGridDegrees: 0.25,
      memberPopulation: "000-030",
      allCacheHit: false,
    });
  });

  it("keeps area spatial aggregation inside each member before ensemble summaries", async () => {
    const service = new AigefsForecastService({
      runProvider,
      memberServiceFactory: (member) => ({
        query: vi.fn(async () => areaResult(member)),
        diagnose: vi.fn(),
      }) as any,
    });

    const result = await service.query(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49.5,
        northLatitude: 50,
      },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["000", "001"], quantiles: [0.5] },
      aggregate: {
        percentiles: [50],
        thresholds: [{ operator: "gte", value: 10 }],
        includeExtremaLocations: true,
      },
    })) as any;

    expect(result.methodology).toBe(
      "spatial_statistics_per_member_then_ensemble_distribution",
    );
    expect(result.statistics.mean.mean).toBe(10.5);
    expect(result.spatialPercentiles[0].distribution.mean).toBe(10.5);
    expect(result.memberExtrema).toHaveLength(2);
  });

  it("aggregates nonlinear layer diagnostics from member diagnostics, not mean profiles", async () => {
    const service = new AigefsForecastService({
      runProvider,
      memberServiceFactory: (member) => ({
        query: vi.fn(),
        diagnose: vi.fn(async () => ({
          model: "aigfs_0p25",
          run: run.toISOString(),
          validTime: "2026-08-30T06:00:00.000Z",
          forecastHour: 6,
          requestedPoint: { latitude: 50, longitude: 14 },
          gridPoint: { latitude: 50, longitude: 14 },
          layer: {
            lowerPressureHpa: 850,
            upperPressureHpa: 700,
            lowerGeopotentialHeightGpm: 1500,
            upperGeopotentialHeightGpm: 3000 + Number(member) * 100,
            depthGpm: 1500 + Number(member) * 100,
          },
          levels: [],
          diagnostics: [{
            id: "temperature_lapse_rate",
            values: { temperatureLapseRateCPerKm: 6 + Number(member) },
          }],
          source: {
            provider: "NOAA NOMADS",
            access: "nomads_range",
            decoder: "wgrib2",
            cacheHit: true,
          },
        })),
      }) as any,
    });

    const result = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-30T06:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      ensemble: { members: ["000", "001"], quantiles: [0.5] },
    })) as any;

    expect(result.summaries[0].distribution.mean).toBe(6.5);
    expect(result.layerDepthGpm.mean).toBe(1550);
  });
});

describe("AIGEFS public contract and NOMADS paths", () => {
  it("accepts native ensemble members and rejects non-native member labels", () => {
    expect(queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["000", "030"] },
    }).dataset).toBe("aigefs");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-30T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: { members: ["000", "031"] },
    })).toThrow("AIGEFS members are 000 through 030");
  });

  it("builds member and ensemble-statistics paths from the operational layout", () => {
    expect(buildAigefsNomadsUrl(run, 6, "000", "pres")).toContain(
      "/aigefs.20260830/00/mem000/model/atmos/grib2/aigefs.t00z.pres.f006.grib2",
    );
    expect(buildAigefsStatisticNomadsUrl(run, 384, "avg", "sfc")).toContain(
      "/aigefs.20260830/00/ensstat/products/atmos/grib2/aigefs.t00z.sfc.avg.f384.grib2",
    );
    expect(aigefsMemberNomadsPaths("030").label).toBe("AIGEFS member 030");
  });
});
