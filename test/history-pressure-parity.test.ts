import { describe, expect, it, vi } from "vitest";
import { NCEI_NCSS_PROVENANCE } from "../src/sources/ncei-gfs-history.js";
import { HistoricalProfileService } from "../src/core/history.js";
import {
  deriveAirDensityKgM3,
  deriveEquivalentPotentialTemperatureK,
  deriveMixingRatioKgKg,
  deriveSaturationVaporPressureHpa,
  deriveSpecificHumidityFromMixingRatioKgKg,
  deriveVirtualTemperatureC,
  deriveWetBulbTemperatureC,
} from "../src/derived/thermodynamics.js";
import { HISTORICAL_GFS_VARIABLE_IDS } from "../src/schema/history.js";
import type { HistoricalAnalysisDataSource } from "../src/sources/gfs-analysis.js";

const dataset = "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2";

function sourceForParity(): HistoricalAnalysisDataSource {
  return {
    fetch: vi.fn(async (request) => {
      const variable = request.variables[0];
      if (variable === "cloud_water_mixing_ratio") {
        return {
          rows: [{
            latitude: 50,
            longitude: 14.5,
            pressureHpa: 850,
            values: { cloud_water_mixing_ratio: 0.00012 },
          }],
          dataset,
          cacheHit: true,
          ...NCEI_NCSS_PROVENANCE,
        };
      }
      if (variable === "ozone_mixing_ratio") {
        return {
          rows: [{
            latitude: 50,
            longitude: 14.5,
            pressureHpa: 850,
            values: { ozone_mixing_ratio: 0.00000008 },
          }],
          dataset,
          cacheHit: true,
          ...NCEI_NCSS_PROVENANCE,
        };
      }
      return {
        rows: [{
          latitude: 50,
          longitude: 14.5,
          pressureHpa: 850,
          values: { temperature: 285.15, relative_humidity: 65 },
        }],
        dataset,
        cacheHit: true,
        ...NCEI_NCSS_PROVENANCE,
      };
    }),
  };
}

function expectedSpecificHumidity(temperatureC: number, relativeHumidityPct: number, pressureHpa: number): number {
  const vaporPressureHpa = deriveSaturationVaporPressureHpa(temperatureC) * relativeHumidityPct / 100;
  const mixingRatioKgKg = 0.622 * vaporPressureHpa / (pressureHpa - vaporPressureHpa);
  return deriveSpecificHumidityFromMixingRatioKgKg(mixingRatioKgKg);
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

  it("derives archive-stable specific humidity from temperature/RH and reuses shared downstream kernels", async () => {
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
    const q = expectedSpecificHumidity(12, 65, 850);
    expect(level.temperatureC).toBeCloseTo(12, 8);
    expect(level.specificHumidityKgKg).toBeCloseTo(q, 12);
    expect(level.mixingRatioKgKg).toBeCloseTo(deriveMixingRatioKgKg(q), 12);
    expect(level.virtualTemperatureC).toBeCloseTo(deriveVirtualTemperatureC(12, q), 12);
    expect(level.airDensityKgM3).toBeCloseTo(deriveAirDensityKgM3(12, q, 850), 12);
    expect(level.wetBulbTemperatureC).toBeCloseTo(deriveWetBulbTemperatureC(12, q, 850), 12);
    expect(level.equivalentPotentialTemperatureK).toBeCloseTo(
      deriveEquivalentPotentialTemperatureK(12, q, 850),
      12,
    );
    expect(source.fetch).toHaveBeenCalledTimes(1);
    expect(source.fetch).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature", "relative_humidity"],
    }));
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
