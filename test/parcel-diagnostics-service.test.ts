import { describe, expect, it, vi } from "vitest";
import { ParcelDiagnosticsService } from "../src/core/parcel-diagnostics.js";
import type { ProfileResult } from "../src/core/types.js";

const profile: ProfileResult = {
  model: "gfs_0p25",
  run: "2026-08-23T06:00:00.000Z",
  validTime: "2026-08-23T12:00:00.000Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  levels: [
    { pressureHpa: 950, geopotentialHeightGpm: 550, temperatureC: 27, specificHumidityKgKg: 0.015 },
    { pressureHpa: 900, geopotentialHeightGpm: 1000, temperatureC: 23, specificHumidityKgKg: 0.012 },
    { pressureHpa: 850, geopotentialHeightGpm: 1500, temperatureC: 14, specificHumidityKgKg: 0.009 },
    { pressureHpa: 800, geopotentialHeightGpm: 2000, temperatureC: 9, specificHumidityKgKg: 0.007 },
    { pressureHpa: 700, geopotentialHeightGpm: 3000, temperatureC: 0, specificHumidityKgKg: 0.004 },
    { pressureHpa: 600, geopotentialHeightGpm: 4200, temperatureC: -10, specificHumidityKgKg: 0.002 },
    { pressureHpa: 500, geopotentialHeightGpm: 5600, temperatureC: -22, specificHumidityKgKg: 0.001 },
    { pressureHpa: 400, geopotentialHeightGpm: 7200, temperatureC: -32, specificHumidityKgKg: 0.0006 },
    { pressureHpa: 300, geopotentialHeightGpm: 9200, temperatureC: -38, specificHumidityKgKg: 0.0003 },
    { pressureHpa: 250, geopotentialHeightGpm: 10400, temperatureC: -25, specificHumidityKgKg: 0.0002 },
  ],
  fields: [
    { id: "surface_pressure", level: { type: "surface" }, temporal: { type: "instantaneous" }, values: { pressurePa: 100000 } },
    { id: "surface_geopotential_height", level: { type: "surface" }, temporal: { type: "instantaneous" }, values: { geopotentialHeightGpm: 100 } },
    { id: "temperature_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { temperatureC: 30 } },
    { id: "specific_humidity_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { specificHumidityKgKg: 0.018 } },
  ],
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", cacheHit: false },
};

const pressureLevelsHpa = profile.levels.map((level) => level.pressureHpa);

describe("ParcelDiagnosticsService", () => {
  it("uses one shared profile fetch with the exact parcel dependencies", async () => {
    const getProfile = vi.fn(async () => profile);
    const service = new ParcelDiagnosticsService({ profileGetter: { getProfile } });
    const result = await service.getParcelDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-23T06:00:00Z",
      validTime: "2026-08-23T12:00:00Z",
      pressureLevelsHpa,
      parcel: "surface_2m",
      source: "s3",
    });

    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(getProfile).toHaveBeenCalledWith({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-23T06:00:00Z",
      validTime: "2026-08-23T12:00:00Z",
      variables: ["temperature", "specific_humidity", "geopotential_height"],
      pressureLevelsHpa,
      fields: ["surface_pressure", "surface_geopotential_height", "temperature_2m", "specific_humidity_2m"],
      source: "s3",
    });
    expect(result.parcel.startingState.definition).toBe("surface_2m");
    expect(result.parcel.capeJkg).toBeGreaterThan(0);
    expect(result.source).toEqual(profile.source);
    expect(result.levels).toEqual(profile.levels);
  });

  it("fails loudly when a required surface field is absent", async () => {
    const missingSurfacePressure = { ...profile, fields: profile.fields?.filter((field) => field.id !== "surface_pressure") };
    const service = new ParcelDiagnosticsService({ profileGetter: { getProfile: async () => missingSurfacePressure } });
    await expect(service.getParcelDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      validTime: "2026-08-23T12:00:00Z",
      pressureLevelsHpa,
      parcel: "surface_2m",
    })).rejects.toThrow(/surface_pressure\.pressurePa/);
  });
});
