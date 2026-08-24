import { describe, expect, it } from "vitest";
import { parseWgrib2PointLine } from "../src/grib/wgrib2.js";

describe("GEFS non-isobaric wgrib2 decoding", () => {
  it("decodes GEFS-only GRIB code and named vertical semantics", () => {
    expect(parseWgrib2PointLine(
      "1:0:d=2026082400:PRMSL:mean sea level:3 hour fcst:lon=14.5,lat=50:val=101325",
    )).toMatchObject({
      code: "PRMSL",
      namedVertical: "mean sea level",
      value: 101325,
    });
    expect(parseWgrib2PointLine(
      "2:10:d=2026082400:CAPE:180-0 mb above ground:3 hour fcst:lon=14.5,lat=50:val=900",
    )).toMatchObject({
      code: "CAPE",
      namedVertical: "180-0 mb above ground",
      value: 900,
    });
  });

  it("keeps temporal metadata for GEFS accumulated and averaged fields", () => {
    expect(parseWgrib2PointLine(
      "1:0:d=2026082400:APCP:surface:0-3 hour acc fcst:lon=14.5,lat=50:val=2.5",
    )?.accumulation).toEqual({ startForecastHour: 0, endForecastHour: 3 });
    expect(parseWgrib2PointLine(
      "2:10:d=2026082400:TCDC:entire atmosphere:0-3 hour ave fcst:lon=14.5,lat=50:val=75",
    )?.average).toEqual({ startForecastHour: 0, endForecastHour: 3 });
  });
});
