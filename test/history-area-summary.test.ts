import { describe, expect, it, vi } from "vitest";
import {
  HistoricalAreaSummaryService,
  estimateHistoricalGridPoints,
  parseHistoricalAreaCsv,
} from "../src/core/history-area-summary.js";
import { HISTORICAL_AREA_PRESSURE_CATALOG } from "../src/catalog/history-area.js";
import { historicalAreaSummaryQuerySchema } from "../src/schema/history-area-summary.js";
import type { HistoricalAnalysisAreaDataSource } from "../src/sources/ncei-gfs-history.js";

const dataset = "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2";
const temperatureCsv = [
  'latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,isobaric[unit="Pa"],Temperature_isobaric[unit="K"]',
  '50,14,2017-05-09T12:00:00Z,85000,283.15',
  '50,14.5,2017-05-09T12:00:00Z,85000,285.15',
  '50.5,14,2017-05-09T12:00:00Z,85000,287.15',
  '50.5,14.5,2017-05-09T12:00:00Z,85000,289.15',
].join("\n");

const windCsv = [
  'latitude,longitude,time,height_above_ground[unit="m"],u-component_of_wind_height_above_ground[unit="m/s"]',
  '50,14,t,10,2',
  '50,14.5,t,10,4',
  '50.5,14,t,10,6',
  '50.5,14.5,t,10,8',
].join("\n");

function source(csv = temperatureCsv, cacheHit = false): HistoricalAnalysisAreaDataSource {
  return {
    fetchArea: vi.fn(async () => ({ csv, dataset, cacheHit })),
  };
}

describe("historical area schema", () => {
  it("accepts exactly one raw pressure or field selection and rejects invalid boxes", () => {
    const base = {
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 50,
      northLatitude: 51,
      analysisTime: "2017-05-09T12:00:00Z",
    };

    expect(historicalAreaSummaryQuerySchema.safeParse({
      ...base,
      variable: "temperature",
      pressureLevelHpa: 850,
    }).success).toBe(true);
    expect(historicalAreaSummaryQuerySchema.safeParse({
      ...base,
      field: "u_wind_10m",
    }).success).toBe(true);

    for (const invalid of [
      base,
      { ...base, variable: "temperature" },
      { ...base, pressureLevelHpa: 850 },
      { ...base, variable: "temperature", pressureLevelHpa: 850, field: "u_wind_10m" },
      { ...base, eastLongitude: 13, field: "u_wind_10m" },
      { ...base, northLatitude: 49, field: "u_wind_10m" },
      { ...base, field: "u_wind_10m", percentiles: [50, 50] },
    ]) {
      expect(historicalAreaSummaryQuerySchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("estimateHistoricalGridPoints", () => {
  it("conservatively estimates a 0.5-degree Grid 4 box", () => {
    expect(estimateHistoricalGridPoints({
      westLongitude: 0,
      eastLongitude: 1,
      southLatitude: 0,
      northLatitude: 1,
    })).toBe(16);
  });
});

describe("parseHistoricalAreaCsv", () => {
  it("normalizes pressure temperature and 0-360 longitudes", () => {
    const points = parseHistoricalAreaCsv(
      temperatureCsv.replaceAll("14.5", "350"),
      HISTORICAL_AREA_PRESSURE_CATALOG.temperature,
      85000,
    );
    expect(points[0]).toEqual({ latitude: 50, longitude: 14, value: 10 });
    expect(points[1]).toEqual({ latitude: 50, longitude: -10, value: 12 });
  });

  it("accepts the generic GDEX alt vertical coordinate for bbox subsets", () => {
    const gdexCsv = [
      'latitude,longitude,time,alt[unit="Pa"],Temperature_isobaric[unit="K"]',
      '50,14,t,85000,283.15',
      '50,14.25,t,85000,285.15',
    ].join("\n");
    const points = parseHistoricalAreaCsv(
      gdexCsv,
      HISTORICAL_AREA_PRESSURE_CATALOG.temperature,
      85000,
    );
    expect(points).toEqual([
      { latitude: 50, longitude: 14, value: 10 },
      { latitude: 50, longitude: 14.25, value: 12 },
    ]);
  });

  it("rejects NCSS nearest-level substitution instead of silently accepting it", () => {
    expect(() => parseHistoricalAreaCsv(
      temperatureCsv.replaceAll("85000", "90000"),
      HISTORICAL_AREA_PRESSURE_CATALOG.temperature,
      85000,
    )).toThrow(/returned vertical coordinate 90000 instead of requested 85000/);
  });

  it("fails clearly on missing coordinates, variables, vertical coordinates, or defined values", () => {
    expect(() => parseHistoricalAreaCsv(
      'foo,Temperature_isobaric\n1,285',
      HISTORICAL_AREA_PRESSURE_CATALOG.temperature,
      85000,
    )).toThrow(/missing latitude\/longitude/);

    expect(() => parseHistoricalAreaCsv(
      'latitude,longitude,isobaric,foo\n50,14,85000,1',
      HISTORICAL_AREA_PRESSURE_CATALOG.temperature,
      85000,
    )).toThrow(/missing variable Temperature_isobaric/);

    expect(() => parseHistoricalAreaCsv(
      'latitude,longitude,Temperature_isobaric\n50,14,285',
      HISTORICAL_AREA_PRESSURE_CATALOG.temperature,
      85000,
    )).toThrow(/missing the vertical coordinate/);

    expect(() => parseHistoricalAreaCsv(
      'latitude,longitude,isobaric,Temperature_isobaric\n50,14,85000,NaN',
      HISTORICAL_AREA_PRESSURE_CATALOG.temperature,
      85000,
    )).toThrow(/no defined grid values/);
  });
});

describe("HistoricalAreaSummaryService", () => {
  it("uses one native bbox subset for pressure statistics and distributions", async () => {
    const dataSource = source();
    const service = new HistoricalAreaSummaryService({
      source: dataSource,
      now: () => new Date("2017-05-10T00:00:00Z"),
    });

    const result = await service.summarize({
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 50,
      northLatitude: 51,
      analysisTime: "2017-05-09T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      percentiles: [50],
      thresholds: [{ operator: "gte", value: 14 }],
      includeExtremaLocations: true,
    });

    expect(dataSource.fetchArea).toHaveBeenCalledOnce();
    expect(dataSource.fetchArea).toHaveBeenCalledWith({
      analysisTime: new Date("2017-05-09T12:00:00Z"),
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 50,
      northLatitude: 51,
      variables: ["Temperature_isobaric"],
      verticalCoordinate: 85000,
    });
    expect(result).toMatchObject({
      model: "gfs_grid4_analysis_0p5",
      analysisTime: "2017-05-09T12:00:00.000Z",
      variable: {
        id: "temperature",
        pressureHpa: 850,
        field: "temperatureC",
        unit: "degC",
      },
      statistics: {
        definedGridPoints: 4,
        mean: 13,
        min: 10,
        max: 16,
        meanKind: "unweighted_grid_point_mean",
      },
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        subset: "native_bbox_grid",
        dataset,
        cacheHit: false,
      },
      distribution: {
        percentiles: [{ percentile: 50, value: 13 }],
        thresholdFractions: [{
          operator: "gte",
          threshold: 14,
          matchingGridPoints: 2,
          fraction: 0.5,
        }],
      },
    });
    expect(result.distribution?.extrema).toEqual({
      min: { value: 10, gridPoint: { latitude: 50, longitude: 14 }, tiedGridPoints: 1 },
      max: { value: 16, gridPoint: { latitude: 50.5, longitude: 14.5 }, tiedGridPoints: 1 },
    });
  });

  it("uses field-specific vertical coordinates and omits distributions when not requested", async () => {
    const dataSource = source(windCsv, true);
    const result = await new HistoricalAreaSummaryService({
      source: dataSource,
      now: () => new Date("2017-05-10T00:00:00Z"),
    }).summarize({
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 50,
      northLatitude: 51,
      analysisTime: "2017-05-09T12:00:00Z",
      field: "u_wind_10m",
    });

    expect(dataSource.fetchArea).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["u-component_of_wind_height_above_ground"],
      verticalCoordinate: 10,
    }));
    expect(result.field).toEqual({
      id: "u_wind_10m",
      level: { type: "height_above_ground_m", heightM: 10 },
      temporal: { type: "instantaneous" },
      output: { field: "uWindMs", unit: "m/s" },
    });
    expect(result.statistics).toMatchObject({ mean: 5, min: 2, max: 8 });
    expect(result.distribution).toBeUndefined();
    expect(result.source.cacheHit).toBe(true);
  });

  it("rejects archive limits, future analyses, and oversized boxes before source access", async () => {
    const dataSource = source();
    const service = new HistoricalAreaSummaryService({
      source: dataSource,
      now: () => new Date("2017-05-10T00:00:00Z"),
    });
    const base = {
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 50,
      northLatitude: 51,
      variable: "temperature" as const,
      pressureLevelHpa: 850,
    };

    await expect(service.summarize({
      ...base,
      analysisTime: "2006-12-31T18:00:00Z",
    })).rejects.toThrow(/history begins/);

    await expect(service.summarize({
      ...base,
      analysisTime: "2017-05-10T06:00:00Z",
    })).rejects.toThrow(/must not be in the future/);

    await expect(service.summarize({
      ...base,
      analysisTime: "2017-05-09T12:00:00Z",
      westLongitude: -100,
      eastLongitude: 100,
      southLatitude: -50,
      northLatitude: 50,
      maxGridPoints: 100,
    })).rejects.toThrow(/exceeding maxGridPoints=100/);

    expect(dataSource.fetchArea).not.toHaveBeenCalled();
  });
});
