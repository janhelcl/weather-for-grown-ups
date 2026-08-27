import { describe, expect, it, vi } from "vitest";
import { HistoricalProfileService, parseHistoricalProfileCsv } from "../src/core/history.js";
import {
  buildNceiGfsAnalysisAreaUrl,
  buildNceiGfsAnalysisDatasetPath,
  buildNceiGfsAnalysisPointUrl,
  type HistoricalAnalysisDataSource,
} from "../src/sources/ncei-gfs-history.js";

const dataset = "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_0000_000.grb2";
const csv = [
  'station_name,station_description,latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,vertCoord[unit="Pa"],Temperature_isobaric[unit="K"],Relative_humidity_isobaric[unit="%"],u-component_of_wind_isobaric[unit="m/s"],v-component_of_wind_isobaric[unit="m/s"],Geopotential_height_isobaric[unit="gpm"]',
  'point,point,50,14.5,2017-05-09T00:00:00Z,85000,285.15,65,3,4,1500',
  'point,point,50,14.5,2017-05-09T00:00:00Z,70000,273.15,40,-10,0,3100',
].join("\n");

const verticalVelocityCsv = [
  'station_name,latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,isobaric3[unit="Pa"],Vertical_velocity_pressure_isobaric[unit="Pa/s"]',
  'point,50,14.5,2017-05-09T00:00:00Z,85000,-0.12',
  'point,50,14.5,2017-05-09T00:00:00Z,70000,-0.08',
].join("\n");

const vorticityCsv = [
  'station_name,latitude[unit="degrees_north"],longitude[unit="degrees_east"],time,isobaric2[unit="Pa"],Absolute_vorticity_isobaric[unit="1/s"]',
  'point,50,14.5,2017-05-09T00:00:00Z,85000,0.00008',
  'point,50,14.5,2017-05-09T00:00:00Z,70000,0.00010',
].join("\n");

function mockSource(): HistoricalAnalysisDataSource {
  return {
    fetch: vi.fn(async () => ({
      csv,
      dataset,
      cacheHit: false,
    })),
  };
}

describe("HistoricalProfileService", () => {
  it("returns normalized archived analysis fields and deterministic derived diagnostics", async () => {
    const source = mockSource();
    const service = new HistoricalProfileService({
      source,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    const result = await service.getHistoricalProfile({
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T00:00:00Z",
      variables: [
        "temperature",
        "relative_humidity",
        "wind",
        "geopotential_height",
        "dew_point",
        "potential_temperature",
      ],
      pressureLevelsHpa: [850, 700],
    });

    expect(result).toMatchObject({
      model: "gfs_grid4_analysis_0p5",
      analysisTime: "2017-05-09T00:00:00.000Z",
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        cacheHit: false,
      },
    });
    expect(result.levels.map((level) => level.pressureHpa)).toEqual([850, 700]);
    expect(result.levels[0]).toMatchObject({
      temperatureC: 12,
      relativeHumidityPct: 65,
      uWindMs: 3,
      vWindMs: 4,
      windSpeedMs: 5,
      geopotentialHeightGpm: 1500,
    });
    expect(result.levels[0]?.windDirectionDeg).toBeCloseTo(216.87, 1);
    expect(result.levels[0]?.dewPointC).toBeCloseTo(5.6222, 4);
    expect(result.levels[0]?.potentialTemperatureK).toBeCloseTo(298.6876, 4);

    expect(source.fetch).toHaveBeenCalledWith(expect.objectContaining({
      variables: [
        "Temperature_isobaric",
        "Relative_humidity_isobaric",
        "u-component_of_wind_isobaric",
        "v-component_of_wind_isobaric",
        "Geopotential_height_isobaric",
      ],
    }));
  });

  it("splits variables with incompatible historical pressure axes and merges their levels", async () => {
    const fetch = vi.fn(async (request: { variables: readonly string[] }) => {
      if (request.variables.includes("Vertical_velocity_pressure_isobaric")) {
        return { csv: verticalVelocityCsv, dataset, cacheHit: true };
      }
      if (request.variables.includes("Absolute_vorticity_isobaric")) {
        return { csv: vorticityCsv, dataset, cacheHit: true };
      }
      return { csv, dataset, cacheHit: true };
    });
    const service = new HistoricalProfileService({ source: { fetch } });

    const result = await service.getHistoricalProfile({
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T00:00:00Z",
      variables: ["temperature", "vertical_velocity", "absolute_vorticity"],
      pressureLevelsHpa: [850, 700],
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([request]) => request.variables)).toEqual([
      ["Temperature_isobaric"],
      ["Vertical_velocity_pressure_isobaric"],
      ["Absolute_vorticity_isobaric"],
    ]);
    expect(result.levels[0]).toMatchObject({
      pressureHpa: 850,
      temperatureC: 12,
      verticalVelocityPaS: -0.12,
      absoluteVorticityS1: 0.00008,
    });
    expect(result.source.cacheHit).toBe(true);
  });

  it("rejects non-cycle times, pre-archive dates, and future analyses", async () => {
    const service = new HistoricalProfileService({
      source: mockSource(),
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    const base = {
      latitude: 50,
      longitude: 14,
      variables: ["temperature" as const],
      pressureLevelsHpa: [850],
    };

    await expect(service.getHistoricalProfile({
      ...base,
      analysisTime: "2017-05-09T01:00:00Z",
    })).rejects.toThrow(/00, 06, 12, or 18 UTC/);
    await expect(service.getHistoricalProfile({
      ...base,
      analysisTime: "2006-12-31T18:00:00Z",
    })).rejects.toThrow(/begins at 2007-01-01/);
    await expect(service.getHistoricalProfile({
      ...base,
      analysisTime: "2026-08-26T18:00:00Z",
    })).rejects.toThrow(/must not be in the future/);
  });

  it("fails explicitly when a requested level is absent from the archive variable", async () => {
    const service = new HistoricalProfileService({ source: mockSource() });
    await expect(service.getHistoricalProfile({
      latitude: 50,
      longitude: 14,
      analysisTime: "2017-05-09T00:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [925],
    })).rejects.toThrow("temperature@925mb");
  });
});

describe("NCEI historical GFS access", () => {
  it("uses the historical gfsanl naming before June 2020 and gfs naming afterwards", () => {
    expect(buildNceiGfsAnalysisDatasetPath(new Date("2017-05-09T12:00:00Z"))).toBe(
      "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2",
    );
    expect(buildNceiGfsAnalysisDatasetPath(new Date("2020-06-01T00:00:00Z"))).toBe(
      "model-gfs-g4-anl-files/202006/20200601/gfs_4_20200601_0000_000.grb2",
    );
  });

  it("builds one NCSS grid-as-point request for variables sharing a pressure axis", () => {
    const url = new URL(buildNceiGfsAnalysisPointUrl({
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      latitude: 50.08,
      longitude: 14.43,
      variables: ["Temperature_isobaric", "Relative_humidity_isobaric"],
    }));
    expect(url.pathname).toContain("/thredds/ncss/grid/model-gfs-g4-anl-files-old/201705/20170509/");
    expect(url.searchParams.get("var")).toBe("Temperature_isobaric,Relative_humidity_isobaric");
    expect(url.searchParams.get("latitude")).toBe("50.08");
    expect(url.searchParams.get("longitude")).toBe("14.43");
    expect(url.searchParams.get("time")).toBe("all");
    expect(url.searchParams.get("accept")).toBe("csv");
  });

  it("builds one native NCSS bbox request with exact vertical-coordinate selection", () => {
    const url = new URL(buildNceiGfsAnalysisAreaUrl({
      analysisTime: new Date("2017-05-09T12:00:00Z"),
      westLongitude: 12,
      eastLongitude: 18,
      southLatitude: 48,
      northLatitude: 51,
      variables: ["Temperature_isobaric"],
      verticalCoordinate: 85000,
      horizontalStride: 2,
    }));
    expect(url.pathname).toContain("/thredds/ncss/grid/model-gfs-g4-anl-files-old/201705/20170509/");
    expect(url.searchParams.get("var")).toBe("Temperature_isobaric");
    expect(url.searchParams.get("west")).toBe("12");
    expect(url.searchParams.get("east")).toBe("18");
    expect(url.searchParams.get("south")).toBe("48");
    expect(url.searchParams.get("north")).toBe("51");
    expect(url.searchParams.get("vertCoord")).toBe("85000");
    expect(url.searchParams.get("horizStride")).toBe("2");
    expect(url.searchParams.has("latitude")).toBe(false);
    expect(url.searchParams.has("longitude")).toBe(false);
    expect(url.searchParams.get("accept")).toBe("csv");
  });

  it("omits optional bbox subsetting parameters when they are not needed", () => {
    const url = new URL(buildNceiGfsAnalysisAreaUrl({
      analysisTime: new Date("2017-05-09T12:00:00Z"),
      westLongitude: 12,
      eastLongitude: 18,
      southLatitude: 48,
      northLatitude: 51,
      variables: ["Pressure_surface"],
    }));
    expect(url.searchParams.has("vertCoord")).toBe(false);
    expect(url.searchParams.has("horizStride")).toBe(false);
  });

  it("parses Pa pressure coordinates and normalizes 0-360 longitudes", () => {
    const parsed = parseHistoricalProfileCsv(
      csv.replaceAll("14.5", "350"),
      ["temperature"],
      [850],
      { latitude: 50.08, longitude: -10 },
    );
    expect(parsed.gridPoint).toEqual({ latitude: 50, longitude: -10 });
    expect(parsed.levels[0]).toMatchObject({ pressureHpa: 850, temperatureC: 12 });
  });
});
