import { describe, expect, it } from "vitest";
import { archivedGfsForecastHoursInRange } from "../src/core/archived-gfs-query.js";
import { forecastHour, nativeForecastHoursInRange } from "../src/core/forecast-hour.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";
import { buildGfsS3ForecastUrl } from "../src/sources/gfs-s3.js";
import { buildNomadsPointUrl } from "../src/sources/nomads.js";
import {
  buildRdaGfs025ForecastDatasetPath,
  buildRdaGfs025ForecastPointUrl,
} from "../src/sources/rda-gfs-forecast-history.js";

const temperature = {
  id: "temperature",
  gfsCode: "TMP",
  description: "Temperature",
  unit: "K",
  field: "temperatureC",
  transform: (value: number) => value - 273.15,
} as any;

describe("resolution-aware operational GFS paths", () => {
  it("builds NOMADS 0.5 filter and filename when selected", () => {
    const url = new URL(buildNomadsPointUrl({
      run: new Date("2026-08-27T00:00:00Z"),
      grid: "0p50",
      forecastHour: 12,
      latitude: 50,
      longitude: 14,
      variables: [temperature],
      pressureLevelsHpa: [850],
    }));
    expect(url.pathname).toBe("/cgi-bin/filter_gfs_0p50.pl");
    expect(url.searchParams.get("file")).toBe("gfs.t00z.pgrb2.0p50.f012");
  });

  it("builds NOAA AWS 0.5 object paths", () => {
    expect(buildGfsS3ForecastUrl(
      new Date("2026-08-27T06:00:00Z"),
      24,
      "0p50",
    )).toContain("/gfs.20260827/06/atmos/gfs.t06z.pgrb2.0p50.f024");
  });

  it("preserves hourly 0.25 cadence but enforces 3-hour 0.5 cadence", () => {
    const run = new Date("2026-08-27T00:00:00Z");
    expect(forecastHour(run, new Date("2026-08-27T01:00:00Z"), "0p25")).toBe(1);
    expect(() => forecastHour(run, new Date("2026-08-27T01:00:00Z"), "0p50"))
      .toThrow("GFS 0.5° output is available every 3 hours");
    expect(nativeForecastHoursInRange(
      run,
      new Date("2026-08-27T00:00:00Z"),
      new Date("2026-08-27T09:00:00Z"),
      "0p50",
    )).toEqual([0, 3, 6, 9]);
  });
});

describe("NCAR/GDEX 0.25 archive paths and cadence", () => {
  it("builds d084001 file and NCSS paths compatible with Glideator history", () => {
    const run = new Date("2023-10-01T00:00:00Z");
    expect(buildRdaGfs025ForecastDatasetPath(run, 24))
      .toBe("2023/20231001/gfs.0p25.2023100100.f024.grib2");
    const url = new URL(buildRdaGfs025ForecastPointUrl({
      runTime: run,
      forecastHour: 24,
      latitude: 50,
      longitude: 14,
      variables: ["Temperature_isobaric"],
    }));
    expect(url.pathname).toContain(
      "/thredds/ncss/grid/files/g/d084001/2023/20231001/gfs.0p25.2023100100.f024.grib2",
    );
    expect(url.searchParams.get("var")).toBe("Temperature_isobaric");
  });

  it("uses native 3-hour steps through 240h and 12-hour steps afterwards", () => {
    const run = new Date("2023-10-01T00:00:00Z");
    expect(archivedGfsForecastHoursInRange(
      run,
      new Date("2023-10-11T00:00:00Z"),
      new Date("2023-10-12T00:00:00Z"),
      "0p25",
    )).toEqual([240, 252, 264]);
  });
});

describe("unified GFS grid/source vocabulary", () => {
  const base = {
    dataset: "gfs" as const,
    geometry: { type: "point" as const, latitude: 50, longitude: 14 },
    time: { at: "2026-08-27T12:00:00Z" },
    selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
  };

  it("defaults GFS to 0.25 and accepts explicit 0.5", () => {
    expect(queryAtmosphereSchema.parse({ ...base, forecast: { run: "latest" } }).forecast?.grid)
      .toBe("0p25");
    expect(queryAtmosphereSchema.parse({
      ...base,
      forecast: { run: "latest", grid: "0p50" },
    }).forecast?.grid).toBe("0p50");
  });

  it("accepts archive as an explicit GFS backend override", () => {
    expect(queryAtmosphereSchema.parse({
      ...base,
      forecast: { run: "2026-08-24T00:00:00Z", grid: "0p25" },
      source: "archive",
    }).source).toBe("archive");
  });
});
