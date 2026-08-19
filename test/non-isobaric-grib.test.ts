import { describe, expect, it } from "vitest";
import { expandRequestedFields } from "../src/catalog/non-isobaric-fields.js";
import { parseGribIndex, selectNonIsobaricByteRanges } from "../src/grib/index.js";
import { parseWgrib2PointLine } from "../src/grib/wgrib2.js";
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

  it("does not misclassify PV surfaces as the model surface", () => {
    expect(parseWgrib2PointLine("9:64:d=2026081906:TMP:PV=2e-06 (Km^2/kg/s) surface:6 hour fcst:lon=14.5,lat=50,val=220")).toBeNull();
  });
});
