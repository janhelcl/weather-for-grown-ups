import { describe, expect, it, vi } from "vitest";
import {
  IgraObservationProfileService,
  greatCircleDistanceKm,
  selectIgraStation,
} from "../src/core/igra-observation.js";
import type { IgraStation } from "../src/sources/ncei-igra.js";

const stations: IgraStation[] = [
  {
    id: "EZM00011520",
    latitude: 50.0078,
    longitude: 14.4469,
    elevationM: 302,
    name: "PRAHA-LIBUS",
    firstYear: 1969,
    lastYear: 2026,
    observations: 70000,
  },
  {
    id: "EZM00011747",
    latitude: 49.4525,
    longitude: 17.1347,
    elevationM: 214.8,
    name: "PROSTEJOV",
    firstYear: 2003,
    lastYear: 2026,
    observations: 12000,
  },
];

describe("IGRA station selection", () => {
  it("chooses the nearest station that covers the verification year", () => {
    expect(selectIgraStation(
      stations,
      { latitude: 50.08, longitude: 14.43 },
      2020,
      250,
    ).id).toBe("EZM00011520");
  });

  it("enforces explicit-station distance guardrails", () => {
    expect(() => selectIgraStation(
      stations,
      { latitude: 50.08, longitude: 14.43 },
      2020,
      50,
      "EZM00011747",
    )).toThrow(/beyond maxStationDistanceKm/);
  });

  it("computes a small Prague-to-Libus distance", () => {
    expect(greatCircleDistanceKm(50.08, 14.43, 50.0078, 14.4469)).toBeLessThan(10);
  });
});

describe("IgraObservationProfileService", () => {
  it("keeps only exact requested pressure levels and requested variables", async () => {
    const source = {
      listStations: vi.fn(async () => stations),
      getSounding: vi.fn(async () => ({
        stationId: "EZM00011520",
        nominalTime: "2026-08-24T12:00:00.000Z",
        soundingLatitude: 50.0078,
        soundingLongitude: 14.4469,
        levels: [
          {
            pressureHpa: 850,
            temperatureC: 14,
            relativeHumidityPct: 60,
            geopotentialHeightGpm: 1500,
            windSpeedMs: 8,
            windDirectionDeg: 250,
          },
          { pressureHpa: 800, temperatureC: 10 },
          { pressureHpa: 700, temperatureC: 2, relativeHumidityPct: 40 },
        ],
        sourceFile: "https://example.test/igra.zip",
        cacheHit: true,
      })),
    };

    const service = new IgraObservationProfileService({
      source,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });
    const result = await service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      validTime: new Date("2026-08-24T12:00:00Z"),
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850, 700, 500],
      maxStationDistanceKm: 250,
    });

    expect(result.matchedPressureLevelsHpa).toEqual([850, 700]);
    expect(result.missingPressureLevelsHpa).toEqual([500]);
    expect(result.levels).toEqual([
      {
        pressureHpa: 850,
        temperatureC: 14,
        windSpeedMs: 8,
        windDirectionDeg: 250,
      },
      { pressureHpa: 700, temperatureC: 2 },
    ]);
    expect(source.getSounding).toHaveBeenCalledWith(
      "EZM00011520",
      new Date("2026-08-24T12:00:00Z"),
    );
  });

  it("does not interpolate when no requested level is observed", async () => {
    const service = new IgraObservationProfileService({
      source: {
        listStations: vi.fn(async () => stations),
        getSounding: vi.fn(async () => ({
          stationId: "EZM00011520",
          nominalTime: "2026-08-24T12:00:00.000Z",
          soundingLatitude: 50.0078,
          soundingLongitude: 14.4469,
          levels: [{ pressureHpa: 849.5, temperatureC: 14 }],
          sourceFile: "test.zip",
          cacheHit: false,
        })),
      },
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    await expect(service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      validTime: new Date("2026-08-24T12:00:00Z"),
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxStationDistanceKm: 250,
    })).rejects.toThrow(/no vertical interpolation/);
  });
});
