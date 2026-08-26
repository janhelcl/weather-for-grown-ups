import { describe, expect, it, vi } from "vitest";
import { HistoricalParcelService } from "../src/core/history-parcel.js";
import {
  handleGetGfsHistoricalParcel,
  handleGetGfsHistoricalParcelTimeSeries,
} from "../src/mcp-history-parcel-tool.js";
import type { HistoricalFieldsResult } from "../src/schema/history-fields.js";

const pressureLevelsHpa = [950, 900, 850, 800, 700, 600, 500, 400, 300, 250];
const state: HistoricalFieldsResult = {
  model: "gfs_grid4_analysis_0p5",
  analysisTime: "2017-05-09T12:00:00.000Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    variables: ["temperature", "specific_humidity", "geopotential_height"],
    pressureLevelsHpa,
    fields: ["surface_pressure", "surface_geopotential_height", "temperature_2m", "relative_humidity_2m"],
  },
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
    { id: "relative_humidity_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { relativeHumidityPct: 67 } },
  ],
  source: {
    provider: "NOAA NCEI",
    access: "ncei_thredds_ncss",
    dataset: "archive.grb2",
    cacheHit: true,
  },
  caveat: "GFS model analysis fields; not direct observations or homogeneous climatological reanalysis",
};

async function singleParcel() {
  return new HistoricalParcelService({ fieldsGetter: { getHistoricalFields: async () => state } })
    .getHistoricalParcel({
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      pressureLevelsHpa,
      parcel: "surface_2m",
    });
}

describe("historical parcel MCP handlers", () => {
  it("returns structured single-time parcel diagnostics", async () => {
    const parcel = await singleParcel();
    const result = await handleGetGfsHistoricalParcel({
      getHistoricalParcel: vi.fn(async () => parcel),
    } as never, {
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      pressureLevelsHpa,
      parcel: "surface_2m",
    });
    expect(result).toMatchObject({
      structuredContent: {
        model: "gfs_grid4_analysis_0p5",
        parcel: { startingState: { definition: "surface_2m" } },
      },
    });
  });

  it("returns structured parcel time series", async () => {
    const parcel = await singleParcel();
    const result = await handleGetGfsHistoricalParcelTimeSeries({
      getHistoricalParcelTimeSeries: vi.fn(async () => ({
        model: "gfs_grid4_analysis_0p5" as const,
        requestedStartTime: "2017-05-09T00:00:00.000Z",
        requestedEndTime: "2017-05-09T23:59:59.000Z",
        requestedPoint: parcel.requestedPoint,
        gridPoint: parcel.gridPoint,
        selection: { pressureLevelsHpa, parcel: "surface_2m" as const, cycleHoursUtc: [12 as const] },
        source: { provider: "NOAA NCEI" as const, access: "ncei_thredds_ncss" as const },
        series: [{
          analysisTime: parcel.analysisTime,
          levels: parcel.levels,
          parcel: parcel.parcel,
          dataset: parcel.source.dataset,
          cacheHit: parcel.source.cacheHit,
        }],
        caveat: parcel.caveat,
      })),
    } as never, {
      latitude: 50.08,
      longitude: 14.43,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-09T23:59:59Z",
      pressureLevelsHpa,
      parcel: "surface_2m",
      cycleHoursUtc: [12],
      maxSteps: 1,
    });
    expect(result).toMatchObject({
      structuredContent: {
        series: [{ parcel: { startingState: { definition: "surface_2m" } } }],
      },
    });
  });

  it("returns service errors", async () => {
    const result = await handleGetGfsHistoricalParcel({
      getHistoricalParcel: vi.fn(async () => { throw new Error("historical parcel unavailable"); }),
    } as never, {
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      pressureLevelsHpa,
      parcel: "surface_2m",
    });
    expect(result).toMatchObject({ isError: true, content: [{ text: "historical parcel unavailable" }] });
  });
});
