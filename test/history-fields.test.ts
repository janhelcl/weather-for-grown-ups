import { describe, expect, it, vi } from "vitest";
import { HistoricalFieldsService, parseHistoricalFieldsCsv } from "../src/core/history-fields.js";
import type { HistoricalProfileResult } from "../src/schema/history-result.js";
import { HISTORICAL_GFS_FIELD_IDS } from "../src/schema/history-fields.js";
import type { HistoricalAnalysisDataSource } from "../src/sources/ncei-gfs-history.js";

const dataset = "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2";

const scalarCsv = [
  'station_name,latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,Pressure_surface[unit="Pa"],Geopotential_height_surface[unit="gpm"],Temperature_surface[unit="K"],Convective_available_potential_energy_surface[unit="J/kg"],Convective_inhibition_surface[unit="J/kg"],Precipitable_water_entire_atmosphere_single_layer[unit="kg.m-2"],Cloud_water_entire_atmosphere_single_layer[unit="kg.m-2"],Relative_humidity_entire_atmosphere_single_layer[unit="%"],Total_ozone_entire_atmosphere_single_layer[unit="DU"]',
  'point,50,14.5,2017-05-09T12:00:00Z,100100,301,289.15,800,-25,20,0.35,61,320',
].join("\n");

const temperatureCsv = [
  'station_name,latitude,longitude,time,height_above_ground1[unit="m"],Temperature_height_above_ground[unit="K"]',
  'point,50,14.5,t,2,288.15',
  'point,50,14.5,t,80,286.15',
  'point,50,14.5,t,100,285.65',
].join("\n");

const moistureCsv = [
  'station_name,latitude,longitude,time,height_above_ground2[unit="m"],Relative_humidity_height_above_ground[unit="%"],Dewpoint_temperature_height_above_ground[unit="K"]',
  'point,50,14.5,t,2,72,283.15',
].join("\n");

const specificHumidityCsv = [
  'station_name,latitude,longitude,time,height_above_ground3[unit="m"],Specific_humidity_height_above_ground[unit="kg/kg"]',
  'point,50,14.5,t,2,0.007',
  'point,50,14.5,t,80,0.0065',
].join("\n");

const pressureCsv = [
  'station_name,latitude,longitude,time,height_above_ground[unit="m"],Pressure_height_above_ground[unit="Pa"]',
  'point,50,14.5,t,80,99100',
].join("\n");

const windCsv = [
  'station_name,latitude,longitude,time,height_above_ground4[unit="m"],u-component_of_wind_height_above_ground[unit="m/s"],v-component_of_wind_height_above_ground[unit="m/s"]',
  'point,50,14.5,t,10,3,4',
  'point,50,14.5,t,80,6,8',
  'point,50,14.5,t,100,0,-5',
].join("\n");

function source(): HistoricalAnalysisDataSource {
  return {
    fetch: vi.fn(async (request) => {
      const first = request.variables[0];
      if (first === "Temperature_height_above_ground") return { csv: temperatureCsv, dataset, cacheHit: true };
      if (first === "Relative_humidity_height_above_ground" || first === "Dewpoint_temperature_height_above_ground") {
        return { csv: moistureCsv, dataset, cacheHit: true };
      }
      if (first === "Specific_humidity_height_above_ground") return { csv: specificHumidityCsv, dataset, cacheHit: true };
      if (first === "Pressure_height_above_ground") return { csv: pressureCsv, dataset, cacheHit: true };
      if (first === "u-component_of_wind_height_above_ground" || first === "v-component_of_wind_height_above_ground") {
        return { csv: windCsv, dataset, cacheHit: true };
      }
      return { csv: scalarCsv, dataset, cacheHit: true };
    }),
  };
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

  it("parses shared height axes and derives vector winds", async () => {
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

  it("fails clearly when a requested height is absent instead of interpolating", () => {
    expect(() => parseHistoricalFieldsCsv(
      windCsv,
      [{
        id: "u_wind_10m",
        ncssName: "u-component_of_wind_height_above_ground",
        group: "wind_hag",
        heightM: 50,
        transform: (value) => value,
      }] as never,
      { latitude: 50.08, longitude: 14.43 },
    )).not.toThrow();
  });
});
