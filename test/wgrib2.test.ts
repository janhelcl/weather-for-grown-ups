import { describe, expect, it } from "vitest";
import { parseWgrib2PointLine } from "../src/grib/wgrib2.js";

describe("parseWgrib2PointLine", () => {
  it("parses NOAA wgrib2 -s -lon inventory and normalizes longitude", () => {
    const line = "12:12345:d=2026081906:TMP:850 mb:6 hour fcst:lon=350,lat=50,val=285.4";
    expect(parseWgrib2PointLine(line)).toEqual({
      code: "TMP",
      pressureHpa: 850,
      value: 285.4,
      gridPoint: { longitude: -10, latitude: 50 },
    });
  });

  it("ignores unsupported records", () => {
    expect(parseWgrib2PointLine("1:0:d=2026081906:HGT:850 mb:6 hour fcst:lon=14.5,lat=50,val=1500")).toBeNull();
  });
});
