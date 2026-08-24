import { describe, expect, it } from "vitest";
import { rawGefsFieldDefinitions } from "../src/catalog/gefs-fields.js";
import { parseGribIndex, selectNonIsobaricByteRanges } from "../src/grib/index.js";

describe("GEFS non-isobaric GRIB selection", () => {
  it("reuses generic level and temporal matching", () => {
    const records = parseGribIndex([
      "1:0:d=2026082400:APCP:surface:0-3 hour acc fcst:",
      "2:100:d=2026082400:TCDC:entire atmosphere:0-3 hour ave fcst:",
      "3:200:d=2026082400:CAPE:180-0 mb above ground:3 hour fcst:",
      "4:300:d=2026082400:TMP:2 m above ground:3 hour fcst:",
    ].join("\n"));

    expect(selectNonIsobaricByteRanges(records, rawGefsFieldDefinitions([
      "total_precipitation",
      "total_atmosphere_cloud_cover",
      "cape_180mb",
    ]))).toEqual([
      { start: 0, end: 99 },
      { start: 100, end: 199 },
      { start: 200, end: 299 },
    ]);
  });
});
