import { describe, expect, it, vi } from "vitest";
import {
  IgraForecastVerificationService,
  compareForecastToObservation,
} from "../src/core/igra-verification.js";

describe("compareForecastToObservation", () => {
  it("returns observation-minus-forecast changes with circular wind direction", () => {
    const result = compareForecastToObservation(
      [{
        pressureHpa: 850,
        temperatureC: 10,
        windSpeedMs: 8,
        windDirectionDeg: 350,
      }],
      [{
        pressureHpa: 850,
        temperatureC: 12,
        windSpeedMs: 10,
        windDirectionDeg: 10,
      }],
    );

    expect(result).toEqual([{
      pressureHpa: 850,
      changes: [
        {
          field: "temperatureC",
          forecast: 10,
          observation: 12,
          delta: 2,
          deltaKind: "linear",
        },
        {
          field: "windDirectionDeg",
          forecast: 350,
          observation: 10,
          delta: 20,
          deltaKind: "circular_degrees",
        },
        {
          field: "windSpeedMs",
          forecast: 8,
          observation: 10,
          delta: 2,
          deltaKind: "linear",
        },
      ],
    }]);
  });
});

describe("IgraForecastVerificationService", () => {
  it("samples the archived forecast at the sounding location and defaults recent history to 0p25", async () => {
    const observationGetter = {
      getProfile: vi.fn(async () => ({
        nominalTime: "2026-08-24T12:00:00.000Z",
        requestedPoint: { latitude: 50.08, longitude: 14.43 },
        station: {
          id: "EZM00011520",
          name: "PRAHA-LIBUS",
          latitude: 50.0078,
          longitude: 14.4469,
          elevationM: 302,
          firstYear: 1969,
          lastYear: 2026,
          observations: 70000,
          distanceKm: 8,
          soundingLatitude: 50.0078,
          soundingLongitude: 14.4469,
        },
        levels: [{
          pressureHpa: 850,
          temperatureC: 12,
          windSpeedMs: 10,
          windDirectionDeg: 10,
        }],
        matchedPressureLevelsHpa: [850],
        missingPressureLevelsHpa: [700],
        source: {
          provider: "NOAA NCEI" as const,
          access: "igra_v2_2_station_file" as const,
          dataset: "igra_v2_2" as const,
          sourceFile: "https://example.test/EZM00011520.zip",
          cacheHit: true,
        },
      })),
    };
    const forecastGetter = {
      getArchivedForecastProfile: vi.fn(async () => ({
        model: "gfs_0p25_forecast_archive" as const,
        runTime: "2026-08-22T12:00:00.000Z",
        forecastHour: 48,
        validTime: "2026-08-24T12:00:00.000Z",
        requestedPoint: { latitude: 50.0078, longitude: 14.4469 },
        gridPoint: { latitude: 50, longitude: 14.5 },
        selection: {
          variables: ["temperature", "wind"],
          pressureLevelsHpa: [850],
        },
        levels: [{
          pressureHpa: 850,
          temperatureC: 10,
          windSpeedMs: 8,
          windDirectionDeg: 350,
        }],
        source: {
          provider: "NCAR GDEX",
          access: "gdex_thredds_ncss",
          dataset: "test-dataset",
          cacheHit: false,
        },
        caveat: "test",
      })),
    };

    const service = new IgraForecastVerificationService({
      observationGetter,
      forecastGetter,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.verify({
      latitude: 50.08,
      longitude: 14.43,
      validTime: "2026-08-24T12:00:00Z",
      leadHours: 48,
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850, 700],
    });

    expect(result.gfsGrid).toBe("0p25");
    expect(result.matchedPressureLevelsHpa).toEqual([850]);
    expect(result.missingPressureLevelsHpa).toEqual([700]);
    expect(result.pressureLevels[0]!.changes).toContainEqual({
      field: "temperatureC",
      forecast: 10,
      observation: 12,
      delta: 2,
      deltaKind: "linear",
    });
    expect(forecastGetter.getArchivedForecastProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        grid: "0p25",
        runTime: new Date("2026-08-22T12:00:00Z"),
        latitude: 50.0078,
        longitude: 14.4469,
        pressureLevelsHpa: [850],
      }),
    );
  });

  it("honors an explicit 0p50 forecast grid", async () => {
    const observationGetter = {
      getProfile: vi.fn(async () => ({
        nominalTime: "2019-12-26T18:00:00.000Z",
        requestedPoint: { latitude: 50, longitude: 14 },
        station: {
          id: "EZM00011520",
          name: "PRAHA-LIBUS",
          latitude: 50.0078,
          longitude: 14.4469,
          elevationM: 302,
          firstYear: 1969,
          lastYear: 2026,
          observations: 70000,
          distanceKm: 32,
          soundingLatitude: 50.0078,
          soundingLongitude: 14.4469,
        },
        levels: [{ pressureHpa: 850, temperatureC: 1 }],
        matchedPressureLevelsHpa: [850],
        missingPressureLevelsHpa: [],
        source: {
          provider: "NOAA NCEI" as const,
          access: "igra_v2_2_station_file" as const,
          dataset: "igra_v2_2" as const,
          sourceFile: "test.zip",
          cacheHit: true,
        },
      })),
    };
    const forecastGetter = {
      getArchivedForecastProfile: vi.fn(async () => ({
        model: "gfs_grid4_forecast_0p5_archive" as const,
        runTime: "2019-12-24T18:00:00.000Z",
        forecastHour: 48,
        validTime: "2019-12-26T18:00:00.000Z",
        requestedPoint: { latitude: 50.0078, longitude: 14.4469 },
        gridPoint: { latitude: 50, longitude: 14.5 },
        selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
        levels: [{ pressureHpa: 850, temperatureC: 0 }],
        source: {
          provider: "NOAA NCEI",
          access: "ncei_thredds_ncss",
          dataset: "test",
          cacheHit: true,
        },
        caveat: "test",
      })),
    };

    const service = new IgraForecastVerificationService({
      observationGetter,
      forecastGetter,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });
    const result = await service.verify({
      latitude: 50,
      longitude: 14,
      validTime: "2019-12-26T18:00:00Z",
      leadHours: 48,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      gfsGrid: "0p50",
    });

    expect(result.gfsGrid).toBe("0p50");
    expect(forecastGetter.getArchivedForecastProfile).toHaveBeenCalledWith(
      expect.objectContaining({ grid: "0p50" }),
    );
  });
});
