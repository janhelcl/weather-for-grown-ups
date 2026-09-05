import { describe, expect, it, vi } from "vitest";
import {
  HistoricalProfileService,
  parseHistoricalProfileRows,
} from "../src/core/history.js";
import type {
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointRow,
} from "../src/sources/gfs-analysis.js";
import { parseHistoricalNcssPointCsv } from "../src/sources/gfs-analysis-ncss.js";
import {
  NCEI_NCSS_PROVENANCE,
  buildNceiGfsAnalysisAreaUrl,
  buildNceiGfsAnalysisDatasetPath,
  buildNceiGfsAnalysisPointUrl,
} from "../src/sources/ncei-gfs-history.js";

const dataset = "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_0000_000.grb2";
const profileRows: HistoricalAnalysisPointRow[] = [
  {
    latitude: 50,
    longitude: 14.5,
    pressureHpa: 850,
    values: {
      temperature: 285.15,
      relative_humidity: 65,
      u_wind: 3,
      v_wind: 4,
      geopotential_height: 1500,
    },
  },
  {
    latitude: 50,
    longitude: 14.5,
    pressureHpa: 700,
    values: {
      temperature: 273.15,
      relative_humidity: 40,
      u_wind: -10,
      v_wind: 0,
      geopotential_height: 3100,
    },
  },
];

function mockSource(): HistoricalAnalysisDataSource {
  return {
    fetch: vi.fn(async () => ({
      rows: profileRows,
      dataset,
      cacheHit: false,
      ...NCEI_NCSS_PROVENANCE,
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
        "temperature",
        "relative_humidity",
        "u_wind",
        "v_wind",
        "geopotential_height",
      ],
    }));
  });

  it("splits variables with incompatible historical pressure axes and merges their levels", async () => {
    const fetch = vi.fn(async (request: { variables: readonly string[] }) => {
      if (request.variables.includes("vertical_velocity")) {
        return {
          rows: [
            { latitude: 50, longitude: 14.5, pressureHpa: 850, values: { vertical_velocity: -0.12 } },
            { latitude: 50, longitude: 14.5, pressureHpa: 700, values: { vertical_velocity: -0.08 } },
          ],
          dataset,
          cacheHit: true,
          ...NCEI_NCSS_PROVENANCE,
        };
      }
      if (request.variables.includes("absolute_vorticity")) {
        return {
          rows: [
            { latitude: 50, longitude: 14.5, pressureHpa: 850, values: { absolute_vorticity: 0.00008 } },
            { latitude: 50, longitude: 14.5, pressureHpa: 700, values: { absolute_vorticity: 0.00010 } },
          ],
          dataset,
          cacheHit: true,
          ...NCEI_NCSS_PROVENANCE,
        };
      }
      return { rows: profileRows, dataset, cacheHit: true, ...NCEI_NCSS_PROVENANCE };
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
      ["temperature"],
      ["vertical_velocity"],
      ["absolute_vorticity"],
    ]);
    expect(result.levels[0]).toMatchObject({
      pressureHpa: 850,
      temperatureC: 12,
      verticalVelocityPaS: -0.12,
      absoluteVorticityS1: 0.00008,
    });
    expect(result.source.cacheHit).toBe(true);
  });

  it("uses native archive specific humidity when the source advertises it", async () => {
    const fetch = vi.fn(async () => ({
      rows: [{
        latitude: 50,
        longitude: 14,
        pressureHpa: 850,
        values: { specific_humidity: 0.01, temperature: 285.15 },
      }],
      dataset: "gdex",
      cacheHit: true,
      ...NCEI_NCSS_PROVENANCE,
    }));
    const service = new HistoricalProfileService({
      source: { fetch },
      now: () => new Date("2026-08-27T12:00:00Z"),
      allowNonAnalysisCycle: true,
      minimumTime: new Date("2015-01-15T00:00:00Z"),
      nativeSpecificHumidity: true,
    });
    const result = await service.getHistoricalProfile({
      latitude: 50,
      longitude: 14,
      analysisTime: "2026-08-24T06:00:00Z",
      variables: ["specific_humidity", "virtual_temperature"],
      pressureLevelsHpa: [850],
    });
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["specific_humidity", "temperature"],
    }));
    expect(result.levels[0]?.specificHumidityKgKg).toBe(0.01);
    expect(result.levels[0]?.virtualTemperatureC).toBeCloseTo(13.728, 2);
  });

  it("keeps default specific humidity reconstruction for sources without native SPFH", async () => {
    const source = mockSource();
    const service = new HistoricalProfileService({ source });
    const result = await service.getHistoricalProfile({
      latitude: 50,
      longitude: 14,
      analysisTime: "2017-05-09T00:00:00Z",
      variables: ["specific_humidity"],
      pressureLevelsHpa: [850],
    });
    expect(source.fetch).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature", "relative_humidity"],
    }));
    expect(result.levels[0]?.specificHumidityKgKg).toBeGreaterThan(0);
  });

  it("falls back to ordinary derived dependencies when native SPFH is enabled but not needed", async () => {
    const source = mockSource();
    const service = new HistoricalProfileService({
      source,
      nativeSpecificHumidity: true,
    });
    const result = await service.getHistoricalProfile({
      latitude: 50,
      longitude: 14,
      analysisTime: "2017-05-09T00:00:00Z",
      variables: ["dew_point"],
      pressureLevelsHpa: [850],
    });
    expect(source.fetch).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature", "relative_humidity"],
    }));
    expect(result.levels[0]?.dewPointC).toBeDefined();
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

  it("builds one NCSS grid-as-point request for canonical variables sharing a pressure axis", () => {
    const url = new URL(buildNceiGfsAnalysisPointUrl({
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      latitude: 50.08,
      longitude: 14.43,
      variables: ["temperature", "relative_humidity"],
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
      variable: "temperature",
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
      variable: "surface_pressure",
    }));
    expect(url.searchParams.has("vertCoord")).toBe(false);
    expect(url.searchParams.has("horizStride")).toBe(false);
  });

  it("parses the NCAR GDEX grid-as-point CSV pressure axis named alt at the adapter boundary", () => {
    const gdexCsv = [
      'time,alt[unit="Pa"],station,latitude[unit="degrees_north"],longitude[unit="degrees_east"],Temperature_isobaric[unit="K"]',
      '2026-08-24T06:00:00Z,85000,GridPointRequestedAt[50.000N_14.000E],50.000,14.000,285.15',
      '2026-08-24T06:00:00Z,70000,GridPointRequestedAt[50.000N_14.000E],50.000,14.000,273.15',
    ].join("\n");
    const rows = parseHistoricalNcssPointCsv(
      gdexCsv,
      ["temperature"],
      { latitude: 50.08, longitude: 14.43 },
    );
    const parsed = parseHistoricalProfileRows(
      rows,
      ["temperature"],
      [850, 700],
      { latitude: 50.08, longitude: 14.43 },
    );
    expect(parsed.gridPoint).toEqual({ latitude: 50, longitude: 14 });
    expect(parsed.levels).toEqual([
      { pressureHpa: 850, temperatureC: 12 },
      { pressureHpa: 700, temperatureC: 0 },
    ]);
  });

  it("rejects malformed NCSS CSVs missing a requested variable", () => {
    expect(() => parseHistoricalNcssPointCsv(
      'time,alt[unit="Pa"],latitude,longitude\n2026-08-24T06:00:00Z,85000,50,14',
      ["temperature"],
      { latitude: 50, longitude: 14 },
    )).toThrow("missing variable Temperature_isobaric");
  });

  it("parses Pa pressure coordinates and normalizes 0-360 longitudes", () => {
    const csv = [
      'latitude,longitude,vertCoord[unit="Pa"],Temperature_isobaric[unit="K"]',
      "50,350,85000,285.15",
    ].join("\n");
    const rows = parseHistoricalNcssPointCsv(csv, ["temperature"], {
      latitude: 50.08,
      longitude: -10,
    });
    expect(rows).toEqual([{
      latitude: 50,
      longitude: -10,
      pressureHpa: 850,
      values: { temperature: 285.15 },
    }]);
  });

  it("honors Pa units so a 7 hPa row does not overwrite 700 hPa", () => {
    const csv = [
      'latitude,longitude,vertCoord[unit="Pa"],Temperature_isobaric[unit="K"]',
      "50,14.5,85000,281.15",
      "50,14.5,70000,272.15",
      "50,14.5,700,221.15",
    ].join("\n");
    const rows = parseHistoricalNcssPointCsv(csv, ["temperature"], {
      latitude: 50.08,
      longitude: 14.43,
    });
    const parsed = parseHistoricalProfileRows(
      rows,
      ["temperature"],
      [850, 700],
      { latitude: 50.08, longitude: 14.43 },
    );
    expect(parsed.levels).toEqual([
      { pressureHpa: 850, temperatureC: 8 },
      { pressureHpa: 700, temperatureC: -1 },
    ]);
  });
});
