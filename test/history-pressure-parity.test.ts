import { describe, expect, it, vi } from "vitest";
import { HistoricalProfileService } from "../src/core/history.js";
import {
  deriveAirDensityKgM3,
  deriveEquivalentPotentialTemperatureK,
  deriveMixingRatioKgKg,
  deriveVirtualTemperatureC,
  deriveWetBulbTemperatureC,
} from "../src/derived/thermodynamics.js";
import { HISTORICAL_GFS_VARIABLE_IDS } from "../src/schema/history.js";
import type { HistoricalAnalysisDataSource } from "../src/sources/ncei-gfs-history.js";

const dataset = "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2";

const temperatureCsv = [
  'station_name,latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,vertCoord[unit="Pa"],Temperature_isobaric[unit="K"]',
  'point,50,14.5,2017-05-09T12:00:00Z,85000,285.15',
].join("\n");

const humidityCsv = [
  'station_name,latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,isobaric5[unit="Pa"],Specific_humidity_isobaric[unit="kg/kg"]',
  'point,50,14.5,2017-05-09T12:00:00Z,85000,0.0065',
].join("\n");

const cloudCsv = [
  'station_name,latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,isobaric3[unit="Pa"],Cloud_mixing_ratio_isobaric[unit="kg/kg"]',
  'point,50,14.5,2017-05-09T12:00:00Z,85000,0.00012',
].join("\n");

const ozoneCsv = [
  'station_name,latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,isobaric[unit="Pa"],Ozone_Mixing_Ratio_isobaric[unit="kg/kg"]',
  'point,50,14.5,2017-05-09T12:00:00Z,85000,0.00000008',
].join("\n");

function sourceForParity(): HistoricalAnalysisDataSource {
  return {
    fetch: vi.fn(async (request) => {
      const variable = request.variables[0];
      if (variable === "Specific_humidity_isobaric") return { csv: humidityCsv, dataset, cacheHit: true };
      if (variable === "Cloud_mixing_ratio_isobaric") return { csv: cloudCsv, dataset, cacheHit: true };
      if (variable === "Ozone_Mixing_Ratio_isobaric") return { csv: ozoneCsv, dataset, cacheHit: true };
      return { csv: temperatureCsv, dataset, cacheHit: true };
    }),
  };
}

describe("historical pressure parity", () => {
  it("exposes the shared moist-thermodynamic vocabulary", () => {
    expect(HISTORICAL_GFS_VARIABLE_IDS).toEqual(expect.arrayContaining([
      "specific_humidity",
      "mixing_ratio",
      "virtual_temperature",
      "air_density",
      "wet_bulb_temperature",
      "equivalent_potential_temperature",
      "cloud_water_mixing_ratio",
      "ozone_mixing_ratio",
    ]));
  });

  it("reuses the operational thermodynamic kernels on archived native specific humidity", async () => {
    const source = sourceForParity();
    const service = new HistoricalProfileService({ source });
    const result = await service.getHistoricalProfile({
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      variables: [
        "temperature",
        "specific_humidity",
        "mixing_ratio",
        "virtual_temperature",
        "air_density",
        "wet_bulb_temperature",
        "equivalent_potential_temperature",
      ],
      pressureLevelsHpa: [850],
    });

    const level = result.levels[0]!;
    expect(level.temperatureC).toBeCloseTo(12, 8);
    expect(level.specificHumidityKgKg).toBe(0.0065);
    expect(level.mixingRatioKgKg).toBeCloseTo(deriveMixingRatioKgKg(0.0065), 12);
    expect(level.virtualTemperatureC).toBeCloseTo(deriveVirtualTemperatureC(12, 0.0065), 12);
    expect(level.airDensityKgM3).toBeCloseTo(deriveAirDensityKgM3(12, 0.0065, 850), 12);
    expect(level.wetBulbTemperatureC).toBeCloseTo(deriveWetBulbTemperatureC(12, 0.0065, 850), 12);
    expect(level.equivalentPotentialTemperatureK).toBeCloseTo(
      deriveEquivalentPotentialTemperatureK(12, 0.0065, 850),
      12,
    );
    expect(source.fetch).toHaveBeenCalledTimes(2);
  });

  it("maps archive-native cloud water and ozone pressure fields without changing units", async () => {
    const service = new HistoricalProfileService({ source: sourceForParity() });
    const result = await service.getHistoricalProfile({
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      variables: ["cloud_water_mixing_ratio", "ozone_mixing_ratio"],
      pressureLevelsHpa: [850],
    });

    expect(result.levels[0]).toMatchObject({
      pressureHpa: 850,
      cloudWaterMixingRatioKgKg: 0.00012,
      ozoneMixingRatioKgKg: 0.00000008,
    });
  });
});
