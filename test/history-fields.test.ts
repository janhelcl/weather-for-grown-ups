import { describe, expect, it, vi } from "vitest";
import { HistoricalFieldsService } from "../src/core/history-fields.js";
import type { HistoricalProfileResult } from "../src/schema/history-result.js";
import { HISTORICAL_GFS_FIELD_IDS } from "../src/schema/history-fields.js";
import type { HistoricalAnalysisDataSource } from "../src/sources/gfs-analysis.js";
import { parseHistoricalNcssPointCsv } from "../src/sources/gfs-analysis-ncss.js";
import { NCEI_NCSS_PROVENANCE } from "../src/sources/ncei-gfs-history.js";

const dataset = "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2";

const scalarValues = {
  surface_pressure: 100100,
  surface_geopotential_height: 301,
  surface_temperature: 289.15,
  surface_cape: 800,
  surface_cin: -25,
  precipitable_water: 20,
  total_column_cloud_water: 0.35,
  column_relative_humidity: 61,
  total_column_ozone: 320,
} as const;

function source(): HistoricalAnalysisDataSource {
  return {
    fetch: vi.fn(async (request) => {
      const first = request.variables[0];
      if (first === "temperature_2m" || first === "temperature_80m" || first === "temperature_100m") {
        return response([
          { latitude: 50, longitude: 14.5, heightAboveGroundM: 2, values: { temperature_2m: 288.15 } },
          { latitude: 50, longitude: 14.5, heightAboveGroundM: 80, values: { temperature_80m: 286.15 } },
          { latitude: 50, longitude: 14.5, heightAboveGroundM: 100, values: { temperature_100m: 285.65 } },
        ]);
      }
      if (first === "relative_humidity_2m" || first === "dew_point_2m") {
        return response([{
          latitude: 50,
          longitude: 14.5,
          heightAboveGroundM: 2,
          values: { relative_humidity_2m: 72, dew_point_2m: 283.15 },
        }]);
      }
      if (first === "specific_humidity_2m" || first === "specific_humidity_80m") {
        return response([
          { latitude: 50, longitude: 14.5, heightAboveGroundM: 2, values: { specific_humidity_2m: 0.007 } },
          { latitude: 50, longitude: 14.5, heightAboveGroundM: 80, values: { specific_humidity_80m: 0.0065 } },
        ]);
      }
      if (first === "pressure_80m") {
        return response([{
          latitude: 50,
          longitude: 14.5,
          heightAboveGroundM: 80,
          values: { pressure_80m: 99100 },
        }]);
      }
      if (first === "u_wind_10m" || first === "v_wind_10m") {
        return response([
          { latitude: 50, longitude: 14.5, heightAboveGroundM: 10, values: { u_wind_10m: 3, v_wind_10m: 4 } },
          { latitude: 50, longitude: 14.5, heightAboveGroundM: 80, values: { u_wind_80m: 6, v_wind_80m: 8 } },
          { latitude: 50, longitude: 14.5, heightAboveGroundM: 100, values: { u_wind_100m: 0, v_wind_100m: -5 } },
        ]);
      }
      return response([{ latitude: 50, longitude: 14.5, values: scalarValues }]);
    }),
  };
}

function response(rows: any[]) {
  return { rows, dataset, cacheHit: true, ...NCEI_NCSS_PROVENANCE };
}

function profile(): HistoricalProfileResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime: "2017-05-09T12:00:00.000Z",
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    levels: [{ pressureHpa: 850, temperatureC: 12 }],
    source: { provider: "NOAA NCEI", access: "ncei_thredds_ncss", dataset, cacheHit: true },
    caveat: "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
  };
}

describe("historical mixed fields", () => {
  it("declares only archive-supported modern WFG field IDs", () => {
    expect(HISTORICAL_GFS_FIELD_IDS).toEqual(expect.arrayContaining([
      "surface_pressure", "temperature_2m", "wind_10m", "wind_80m", "wind_100m",
      "precipitable_water", "total_column_cloud_water", "surface_cape", "surface_cin",
    ]));
    expect(HISTORICAL_GFS_FIELD_IDS).not.toContain("total_precipitation");
    expect(HISTORICAL_GFS_FIELD_IDS).not.toContain("u_wind_20m");
  });

  it("reads typed height rows and derives vector winds", async () => {
    const dataSource = source();
    const service = new HistoricalFieldsService({ source: dataSource });
    const result = await service.getHistoricalFields({
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      fields: [
        "surface_pressure", "surface_temperature", "surface_cape", "surface_cin",
        "temperature_2m", "relative_humidity_2m", "specific_humidity_2m", "dew_point_2m",
        "wind_10m", "temperature_80m", "specific_humidity_80m", "pressure_80m", "wind_80m",
        "temperature_100m", "wind_100m", "precipitable_water", "total_column_cloud_water",
        "column_relative_humidity", "total_column_ozone",
      ],
    });

    expect(result.gridPoint).toEqual({ latitude: 50, longitude: 14.5 });
    expect(result.fields.find((field) => field.id === "surface_temperature")?.values.temperatureC).toBeCloseTo(16, 8);
    expect(result.fields.find((field) => field.id === "temperature_2m")?.values.temperatureC).toBeCloseTo(15, 8);
    expect(result.fields.find((field) => field.id === "temperature_80m")?.values.temperatureC).toBeCloseTo(13, 8);
    expect(result.fields.find((field) => field.id === "specific_humidity_80m")?.values.specificHumidityKgKg).toBe(0.0065);
    expect(result.fields.find((field) => field.id === "pressure_80m")?.values.pressurePa).toBe(99100);
    expect(result.fields.find((field) => field.id === "wind_10m")?.values).toMatchObject({ windSpeedMs: 5 });
    expect(result.fields.find((field) => field.id === "wind_80m")?.values).toMatchObject({ windSpeedMs: 10 });
    expect(result.fields.find((field) => field.id === "wind_100m")?.values).toMatchObject({ windSpeedMs: 5 });
    expect(result.fields.every((field) => field.temporal.type === "instantaneous")).toBe(true);
    expect(dataSource.fetch).toHaveBeenCalledTimes(6);
  });

  it("accepts the generic GDEX alt axis inside the NCSS adapter", () => {
    const gdexTemperatureCsv = [
      'time,alt[unit="m"],station,latitude[unit="degrees_north"],longitude[unit="degrees_east"],Temperature_height_above_ground[unit="K"]',
      '2026-08-24T06:00:00Z,2,GridPointRequestedAt[50.000N_14.000E],50.000,14.000,288.15',
      '2026-08-24T06:00:00Z,80,GridPointRequestedAt[50.000N_14.000E],50.000,14.000,286.15',
    ].join("\n");
    expect(parseHistoricalNcssPointCsv(
      gdexTemperatureCsv,
      ["temperature_2m"],
      { latitude: 50.08, longitude: 14.43 },
    )).toEqual([{
      latitude: 50,
      longitude: 14,
      heightAboveGroundM: 2,
      values: { temperature_2m: 288.15 },
    }]);
  });

  it("propagates native-specific-humidity capability to mixed pressure profiles", async () => {
    const fetch = vi.fn(async (request: any) => {
      if (request.variables.includes("surface_pressure")) {
        return response([{ latitude: 50, longitude: 14, values: { surface_pressure: 100100 } }]);
      }
      return response([{
        latitude: 50,
        longitude: 14,
        pressureHpa: 850,
        values: { specific_humidity: 0.01 },
      }]);
    });
    const service = new HistoricalFieldsService({
      source: { fetch },
      now: () => new Date("2026-08-27T12:00:00Z"),
      allowNonAnalysisCycle: true,
      minimumTime: new Date("2015-01-15T00:00:00Z"),
      nativeSpecificHumidity: true,
    });
    const result = await service.getHistoricalFields({
      latitude: 50,
      longitude: 14,
      analysisTime: "2026-08-24T06:00:00Z",
      variables: ["specific_humidity"],
      pressureLevelsHpa: [850],
      fields: ["surface_pressure"],
    });
    expect(result.levels?.[0]?.specificHumidityKgKg).toBe(0.01);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["specific_humidity"],
    }));
  });

  it("supports a mixed pressure plus non-isobaric analysis request", async () => {
    const getHistoricalProfile = vi.fn(async () => profile());
    const service = new HistoricalFieldsService({
      source: source(),
      profileGetter: { getHistoricalProfile },
    });
    const result = await service.getHistoricalFields({
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["surface_pressure"],
    });

    expect(result.levels).toEqual([{ pressureHpa: 850, temperatureC: 12 }]);
    expect(result.fields[0]?.values.pressurePa).toBe(100100);
    expect(getHistoricalProfile).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature"], pressureLevelsHpa: [850],
    }));
  });

  it("maps only the exact requested height at the NCSS adapter boundary", () => {
    const windCsv = [
      'station_name,latitude,longitude,time,height_above_ground4[unit="m"],u-component_of_wind_height_above_ground[unit="m/s"]',
      'point,50,14.5,t,10,3',
      'point,50,14.5,t,80,6',
      'point,50,14.5,t,100,0',
    ].join("\n");
    expect(parseHistoricalNcssPointCsv(
      windCsv,
      ["u_wind_10m"],
      { latitude: 50.08, longitude: 14.43 },
    )).toEqual([{
      latitude: 50,
      longitude: 14.5,
      heightAboveGroundM: 10,
      values: { u_wind_10m: 3 },
    }]);
  });
});
