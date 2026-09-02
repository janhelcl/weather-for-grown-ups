import { describe, expect, it } from "vitest";
import { expandRequestedFields } from "../src/catalog/non-isobaric-fields.js";
import { parseGribIndex, selectNonIsobaricByteRanges } from "../src/grib/index.js";
import {
  parseWgrib2PointLine,
  wgrib2LineForecastHour,
} from "../src/grib/wgrib2.js";
import { buildNomadsPointUrl } from "../src/sources/nomads.js";

const indexText = [
  "1:0:d=2026081906:TMP:850 mb:6 hour fcst:",
  "2:8:d=2026081906:PRES:surface:6 hour fcst:",
  "3:16:d=2026081906:TMP:2 m above ground:6 hour fcst:",
  "4:24:d=2026081906:UGRD:10 m above ground:6 hour fcst:",
  "5:32:d=2026081906:VGRD:10 m above ground:6 hour fcst:",
  "6:40:d=2026081906:APCP:surface:0-6 hour acc fcst:",
  "7:48:d=2026081906:APCP:surface:0-6 hour ave fcst:",
].join("\n");

describe("non-isobaric GRIB planning", () => {
  it("selects exact code + vertical semantics and requires accumulation time semantics", () => {
    const records = parseGribIndex(indexText);
    const fields = expandRequestedFields(["surface_pressure", "temperature_2m", "wind_10m", "total_precipitation"]);
    expect(selectNonIsobaricByteRanges(records, fields)).toEqual([
      { start: 8, end: 15 },
      { start: 16, end: 23 },
      { start: 24, end: 31 },
      { start: 32, end: 39 },
      { start: 40, end: 47 },
    ]);
  });

  it("fails before download when the requested exact height is missing", () => {
    expect(() => selectNonIsobaricByteRanges(
      parseGribIndex(indexText),
      expandRequestedFields(["wind_100m"]),
    )).toThrow(/u_wind_100m/);
  });

  it("builds NOMADS variable and level filters without pressure-level placeholders", () => {
    const url = new URL(buildNomadsPointUrl({
      run: new Date("2026-08-19T06:00:00Z"),
      forecastHour: 6,
      latitude: 50.08,
      longitude: 14.43,
      variables: [],
      pressureLevelsHpa: [],
      fields: expandRequestedFields(["temperature_2m", "wind_10m", "total_precipitation"]),
    }));
    expect(url.searchParams.get("var_TMP")).toBe("on");
    expect(url.searchParams.get("var_UGRD")).toBe("on");
    expect(url.searchParams.get("var_VGRD")).toBe("on");
    expect(url.searchParams.get("var_APCP")).toBe("on");
    expect(url.searchParams.get("lev_2_m_above_ground")).toBe("on");
    expect(url.searchParams.get("lev_10_m_above_ground")).toBe("on");
    expect(url.searchParams.get("lev_surface")).toBe("on");
  });
});

describe("non-isobaric wgrib2 decoding", () => {
  it("decodes exact surface and height-above-ground coordinates", () => {
    expect(parseWgrib2PointLine("2:8:d=2026081906:PRES:surface:6 hour fcst:lon=14.5,lat=50,val=100812")).toEqual({
      code: "PRES", surface: true, value: 100812, gridPoint: { longitude: 14.5, latitude: 50 },
    });
    expect(parseWgrib2PointLine("3:16:d=2026081906:TMP:2 m above ground:6 hour fcst:lon=14.5,lat=50,val=293.15")).toEqual({
      code: "TMP", heightAboveGroundM: 2, value: 293.15, gridPoint: { longitude: 14.5, latitude: 50 },
    });
  });

  it("decodes the accumulation interval instead of treating APCP as instantaneous", () => {
    expect(parseWgrib2PointLine("6:40:d=2026081906:APCP:surface:0-6 hour acc fcst:lon=14.5,lat=50,val=4.2")).toEqual({
      code: "APCP",
      surface: true,
      accumulation: { startForecastHour: 0, endForecastHour: 6 },
      value: 4.2,
      gridPoint: { longitude: 14.5, latitude: 50 },
    });
  });

  it("normalizes DWD 10 m gust maxima into the shared wind-gust vocabulary", () => {
    expect(parseWgrib2PointLine(
      "8:56:d=2026081906:VMAX_10M:10 m above ground:5-6 hour max fcst:lon=14.5,lat=50,val=18.5",
    )).toEqual({
      code: "GUST",
      heightAboveGroundM: 10,
      maximum: { startForecastHour: 5, endForecastHour: 6 },
      value: 18.5,
      gridPoint: { longitude: 14.5, latitude: 50 },
    });
  });

  it("decodes Météo-France gust components without leaking decoder/provider aliases", () => {
    expect(parseWgrib2PointLine(
      "9:64:d=2026081906:UGUST:10 m above ground:5-6 hour max fcst:lon=2.35,lat=48.86,val=6",
    )).toEqual({
      code: "U_RAF",
      heightAboveGroundM: 10,
      maximum: { startForecastHour: 5, endForecastHour: 6 },
      value: 6,
      gridPoint: { longitude: 2.35, latitude: 48.86 },
    });
    expect(parseWgrib2PointLine(
      "9:64:d=2026081906:efg10:10 m above ground:5-6 hour max fcst:lon=2.35,lat=48.86,val=6",
    )).toEqual({
      code: "U_RAF",
      heightAboveGroundM: 10,
      maximum: { startForecastHour: 5, endForecastHour: 6 },
      value: 6,
      gridPoint: { longitude: 2.35, latitude: 48.86 },
    });
  });

  it("parses exact sub-hourly forecast leads for native wgrib2 filtering", () => {
    expect(wgrib2LineForecastHour(
      "1:0:d=2026082400:BREF:surface:anl:lon=14,lat=50,val=20",
    )).toBe(0);
    expect(wgrib2LineForecastHour(
      "1:0:d=2026082400:BREF:surface:6 hour fcst:lon=14,lat=50,val=20",
    )).toBe(6);
    expect(wgrib2LineForecastHour(
      "1:0:d=2026082400:BREF:surface:6 hour 15 min fcst:lon=14,lat=50,val=20",
    )).toBe(6.25);
    expect(wgrib2LineForecastHour(
      "1:0:d=2026082400:BREF:surface:375 min fcst:lon=14,lat=50,val=20",
    )).toBe(6.25);
    expect(wgrib2LineForecastHour(
      "1:0:d=2026082400:APCP:surface:0-6 hour acc fcst:lon=14,lat=50,val=2",
    )).toBe(6);
  });

  it("normalizes DWD mean-layer CAPE/CIN without conflating them with surface CAPE/CIN", () => {
    for (const [inventoryCode, expectedCode, value] of [
      ["CAPE_CON", "CAPE_ML", 1240],
      ["CIN", "CIN_ML", 42],
    ] as const) {
      expect(parseWgrib2PointLine(
        `10:72:d=2026090200:${inventoryCode}:local level type 192 0:360 min fcst:ENS=? table4.6=192 pert=1:lon=14.5,lat=50,val=${value}`,
        "DWD",
      )).toEqual({
        code: expectedCode,
        namedVertical: "mean layer",
        value,
        gridPoint: { longitude: 14.5, latitude: 50 },
      });
    }

    expect(parseWgrib2PointLine(
      "12:88:d=2026090200:CAPE:surface:6 hour fcst:lon=14.5,lat=50,val=300",
      "DWD",
    )).toEqual({
      code: "CAPE",
      surface: true,
      value: 300,
      gridPoint: { longitude: 14.5, latitude: 50 },
    });
  });

  it("preserves DWD 2-8 km updraft helicity hourly maxima", () => {
    expect(parseWgrib2PointLine(
      "8:56:d=2026090200:UH_MAX:2000-8000 m above mean sea level:5-6 hour max fcst:lon=14.5,lat=50,val=165",
      "DWD",
    )).toEqual({
      code: "UH_MAX",
      namedVertical: "2-8 km above mean sea level",
      maximum: { startForecastHour: 5, endForecastHour: 6 },
      value: 165,
      gridPoint: { longitude: 14.5, latitude: 50 },
    });
  });

  it("normalizes native surface-to-top column layers", () => {
    expect(parseWgrib2PointLine(
      "10:72:d=2026081906:BREF:surface - top of atmosphere:6 hour fcst:lon=14.5,lat=50,val=32",
    )).toEqual({
      code: "BREF",
      namedVertical: "entire atmosphere",
      value: 32,
      gridPoint: { longitude: 14.5, latitude: 50 },
    });
    expect(parseWgrib2PointLine(
      "1:0:d=2026083118:BREF:atmos col:360 min fcst:lon=14.5,lat=50,val=31",
    )).toEqual({
      code: "BREF",
      namedVertical: "entire atmosphere",
      value: 31,
      gridPoint: { longitude: 14.5, latitude: 50 },
    });
  });

  it("recognizes the current Météo-France linear column-reflectivity tuple", () => {
    expect(parseWgrib2PointLine(
      "2:3763607:d=2026083118:var discipline=0 center=85 local_table=0 parmcat=16 parm=193:surface:6 hour fcst:lon=2.35,lat=48.86,val=32",
    )).toEqual({
      code: "AROME_RFLCTVT_MAX",
      surface: true,
      value: 32,
      gridPoint: { longitude: 2.35, latitude: 48.86 },
    });
  });

  it("does not misclassify PV surfaces as the model surface", () => {
    expect(parseWgrib2PointLine("9:64:d=2026081906:TMP:PV=2e-06 (Km^2/kg/s) surface:6 hour fcst:lon=14.5,lat=50,val=220")).toBeNull();
  });
});
