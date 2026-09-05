import { describe, expect, it, vi } from "vitest";
import {
  HistoricalAreaSummaryService,
  estimateHistoricalGridPoints,
} from "../src/core/history-area-summary.js";
import { historicalAreaSummaryQuerySchema } from "../src/schema/history-area-summary.js";
import type {
  HistoricalAnalysisAreaDataSource,
  HistoricalAnalysisVariableId,
} from "../src/sources/gfs-analysis.js";
import { parseHistoricalNcssAreaCsv } from "../src/sources/gfs-analysis-grib.js";
import { NCEI_NCSS_PROVENANCE } from "../src/sources/ncei-gfs-history.js";

const dataset = "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2";
const temperaturePoints = [
  { latitude: 50, longitude: 14, value: 283.15 },
  { latitude: 50, longitude: 14.5, value: 285.15 },
  { latitude: 50.5, longitude: 14, value: 287.15 },
  { latitude: 50.5, longitude: 14.5, value: 289.15 },
];
const windPoints = [
  { latitude: 50, longitude: 14, value: 2 },
  { latitude: 50, longitude: 14.5, value: 4 },
  { latitude: 50.5, longitude: 14, value: 6 },
  { latitude: 50.5, longitude: 14.5, value: 8 },
];

function source(options: {
  variable?: HistoricalAnalysisVariableId;
  points?: typeof temperaturePoints;
  verticalCoordinate?: number;
  cacheHit?: boolean;
} = {}): HistoricalAnalysisAreaDataSource {
  const variable = options.variable ?? "temperature";
  const points = options.points ?? temperaturePoints;
  const verticalCoordinate = options.verticalCoordinate ?? 85000;
  return {
    fetchArea: vi.fn(async () => ({
      variable,
      points,
      verticalCoordinate,
      dataset,
      cacheHit: options.cacheHit ?? false,
      ...NCEI_NCSS_PROVENANCE,
    })),
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

describe("historical NCSS area adapter", () => {
  it("normalizes 0-360 longitudes while preserving raw provider values", () => {
    const csv = [
      'latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,isobaric[unit="Pa"],Temperature_isobaric[unit="K"]',
      '50,14,2017-05-09T12:00:00Z,85000,283.15',
      '50,350,2017-05-09T12:00:00Z,85000,285.15',
    ].join("\n");
    expect(parseHistoricalNcssAreaCsv(csv, "temperature", 85000)).toEqual([
      { latitude: 50, longitude: 14, value: 283.15 },
      { latitude: 50, longitude: -10, value: 285.15 },
    ]);
  });

  it("accepts the generic GDEX alt vertical coordinate for bbox subsets", () => {
    const gdexCsv = [
      'latitude,longitude,time,alt[unit="Pa"],Temperature_isobaric[unit="K"]',
      '50,14,t,85000,283.15',
      '50,14.25,t,85000,285.15',
    ].join("\n");
    expect(parseHistoricalNcssAreaCsv(gdexCsv, "temperature", 85000)).toEqual([
      { latitude: 50, longitude: 14, value: 283.15 },
      { latitude: 50, longitude: 14.25, value: 285.15 },
    ]);
  });

  it("accepts NCSS CSV when an explicitly selected singleton vertical dimension is collapsed", () => {
    const collapsedCsv = [
      'latitude,longitude,time,Temperature_isobaric[unit="K"]',
      '50,14,t,283.15',
      '50,14.5,t,285.15',
    ].join("\n");
    expect(parseHistoricalNcssAreaCsv(collapsedCsv, "temperature", 85000)).toEqual([
      { latitude: 50, longitude: 14, value: 283.15 },
      { latitude: 50, longitude: 14.5, value: 285.15 },
    ]);
  });

  it("rejects nearest-level substitution instead of silently accepting it", () => {
    const csv = [
      'latitude,longitude,isobaric[unit="Pa"],Temperature_isobaric[unit="K"]',
      '50,14,90000,283.15',
    ].join("\n");
    expect(() => parseHistoricalNcssAreaCsv(csv, "temperature", 85000))
      .toThrow(/contains no values for temperature/);
  });

  it("fails clearly on missing coordinates, variables, or defined values", () => {
    expect(() => parseHistoricalNcssAreaCsv(
      'foo,Temperature_isobaric\n1,285',
      "temperature",
      85000,
    )).toThrow(/missing coordinates or Temperature_isobaric/);

    expect(() => parseHistoricalNcssAreaCsv(
      'latitude,longitude,isobaric,foo\n50,14,85000,1',
      "temperature",
      85000,
    )).toThrow(/missing coordinates or Temperature_isobaric/);

    expect(() => parseHistoricalNcssAreaCsv(
      'latitude,longitude,isobaric,Temperature_isobaric\n50,14,85000,NaN',
      "temperature",
      85000,
    )).toThrow(/contains no values for temperature/);
  });
});

describe("HistoricalAreaSummaryService", () => {
  it("uses one typed native bbox subset for pressure statistics and distributions", async () => {
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
      variable: "temperature",
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
    const dataSource = source({
      variable: "u_wind_10m",
      points: windPoints,
      verticalCoordinate: 10,
      cacheHit: true,
    });
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
      variable: "u_wind_10m",
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

  it("rejects a typed source response for the wrong vertical coordinate", async () => {
    const dataSource = source({ verticalCoordinate: 90000 });
    const service = new HistoricalAreaSummaryService({
      source: dataSource,
      now: () => new Date("2017-05-10T00:00:00Z"),
    });
    await expect(service.summarize({
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 50,
      northLatitude: 51,
      analysisTime: "2017-05-09T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
    })).rejects.toThrow(/returned vertical coordinate 90000 instead of 85000/);
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
