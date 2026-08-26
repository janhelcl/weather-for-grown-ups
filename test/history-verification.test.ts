import { describe, expect, it, vi } from "vitest";
import { ArchivedGfsForecastProfileService } from "../src/core/history-forecast.js";
import {
  HistoricalForecastVerificationService,
  compareForecastToAnalysis,
} from "../src/core/history-verification.js";
import type { HistoricalProfileResult } from "../src/schema/history-result.js";
import type { ArchivedGfsForecastDataSource } from "../src/sources/ncei-gfs-forecast-history.js";
import {
  buildNceiGfsForecastDatasetPath,
  buildNceiGfsForecastPointUrl,
} from "../src/sources/ncei-gfs-forecast-history.js";

const forecastCsv = [
  'station_name,station_description,latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,vertCoord[unit="Pa"],Temperature_isobaric[unit="K"],Relative_humidity_isobaric[unit="%"],u-component_of_wind_isobaric[unit="m/s"],v-component_of_wind_isobaric[unit="m/s"],Geopotential_height_isobaric[unit="gpm"]',
  'point,point,50,14.5,2017-05-09T12:00:00Z,85000,283.15,60,3,4,1490',
].join("\n");

function mockForecastSource(): ArchivedGfsForecastDataSource {
  return {
    fetch: vi.fn(async (request) => ({
      csv: forecastCsv,
      dataset: buildNceiGfsForecastDatasetPath(request.runTime, request.forecastHour),
      cacheHit: false,
    })),
  };
}

function analysisResult(): HistoricalProfileResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime: "2017-05-09T12:00:00.000Z",
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: { variables: ["temperature", "wind"], pressureLevelsHpa: [850] },
    levels: [{
      pressureHpa: 850,
      temperatureC: 12,
      uWindMs: -1.2155,
      vWindMs: -6.8937,
      windSpeedMs: 7,
      windDirectionDeg: 10,
    }],
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2",
      cacheHit: true,
    },
    caveat: "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
  };
}

describe("NCEI archived GFS forecast access", () => {
  it("uses historical and current Grid 4 forecast roots around the June 2020 transition", () => {
    expect(buildNceiGfsForecastDatasetPath(new Date("2019-12-24T12:00:00Z"), 54)).toBe(
      "model-gfs-004-files-old/201912/20191224/gfs_4_20191224_1200_054.grb2",
    );
    expect(buildNceiGfsForecastDatasetPath(new Date("2021-05-05T12:00:00Z"), 48)).toBe(
      "model-gfs-004-files/202105/20210505/gfs_4_20210505_1200_048.grb2",
    );
  });

  it("builds an NCSS point request against the exact archived forecast file", () => {
    const url = new URL(buildNceiGfsForecastPointUrl({
      runTime: new Date("2019-12-24T12:00:00Z"),
      forecastHour: 54,
      latitude: 50.08,
      longitude: 14.43,
      variables: ["Temperature_isobaric", "Relative_humidity_isobaric"],
    }));
    expect(url.pathname).toContain("/model-gfs-004-files-old/201912/20191224/gfs_4_20191224_1200_054.grb2");
    expect(url.searchParams.get("var")).toBe("Temperature_isobaric,Relative_humidity_isobaric");
    expect(url.searchParams.get("time")).toBe("all");
    expect(url.searchParams.get("accept")).toBe("csv");
  });
});

describe("ArchivedGfsForecastProfileService", () => {
  it("reuses historical profile normalization and derived wind for archived forecasts", async () => {
    const source = mockForecastSource();
    const service = new ArchivedGfsForecastProfileService({
      source,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    const result = await service.getArchivedForecastProfile({
      runTime: new Date("2017-05-07T12:00:00Z"),
      forecastHour: 48,
      latitude: 50.08,
      longitude: 14.43,
      variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
      pressureLevelsHpa: [850],
    });

    expect(result).toMatchObject({
      model: "gfs_grid4_forecast_0p5_archive",
      runTime: "2017-05-07T12:00:00.000Z",
      forecastHour: 48,
      validTime: "2017-05-09T12:00:00.000Z",
      gridPoint: { latitude: 50, longitude: 14.5 },
    });
    expect(result.levels[0]).toMatchObject({
      pressureHpa: 850,
      temperatureC: 10,
      relativeHumidityPct: 60,
      windSpeedMs: 5,
      geopotentialHeightGpm: 1490,
    });
  });
});

describe("HistoricalForecastVerificationService", () => {
  it("compares one forecast lead with analysis using analysis-minus-forecast deltas", async () => {
    const analysis = analysisResult();
    const forecast = {
      model: "gfs_grid4_forecast_0p5_archive" as const,
      runTime: "2017-05-07T12:00:00.000Z",
      forecastHour: 48,
      validTime: "2017-05-09T12:00:00.000Z",
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      levels: [{
        pressureHpa: 850,
        temperatureC: 10,
        uWindMs: 0.8682,
        vWindMs: -4.924,
        windSpeedMs: 5,
        windDirectionDeg: 350,
      }],
      source: {
        provider: "NOAA NCEI" as const,
        access: "ncei_thredds_ncss" as const,
        dataset: "model-gfs-004-files-old/201705/20170507/gfs_4_20170507_1200_048.grb2",
        cacheHit: false,
      },
    };
    const service = new HistoricalForecastVerificationService({
      analysisGetter: { getHistoricalProfile: vi.fn(async () => analysis) },
      forecastGetter: { getArchivedForecastProfile: vi.fn(async () => forecast) },
      now: () => new Date("2026-08-26T12:00:00Z"),
    });

    const result = await service.verify({
      latitude: 50.08,
      longitude: 14.43,
      validTime: "2017-05-09T12:00:00Z",
      leadHours: 48,
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850],
    });

    expect(result.forecastRun).toBe("2017-05-07T12:00:00.000Z");
    expect(result.comparison).toBe("analysis_minus_forecast");
    const changes = Object.fromEntries(result.pressureLevels[0]!.changes.map((change) => [change.field, change]));
    expect(changes.temperatureC?.delta).toBe(2);
    expect(changes.windSpeedMs?.delta).toBe(2);
    expect(changes.windDirectionDeg?.delta).toBe(20);
    expect(changes.windDirectionDeg?.deltaKind).toBe("circular_degrees");
  });

  it("rejects leads that do not verify at a native analysis cycle", async () => {
    const service = new HistoricalForecastVerificationService();
    await expect(service.verify({
      latitude: 50,
      longitude: 14,
      validTime: "2017-05-09T12:00:00Z",
      leadHours: 3,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).rejects.toThrow(/multiple of 6 hours/);
  });
});

describe("compareForecastToAnalysis", () => {
  it("does not invent changes for a level missing on one side", () => {
    expect(compareForecastToAnalysis(
      [{ pressureHpa: 850, temperatureC: 10 }],
      [{ pressureHpa: 700, temperatureC: 2 }],
    )).toEqual([
      { pressureHpa: 850, changes: [] },
      { pressureHpa: 700, changes: [] },
    ]);
  });
});
