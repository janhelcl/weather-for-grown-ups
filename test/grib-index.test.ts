import { describe, expect, it } from "vitest";
import {
  parseGribIndex,
  selectAllPressureByteRanges,
  selectNamedLevelByteRanges,
  selectNonIsobaricByteRangesAtForecastHour,
  selectPressureByteRanges,
  selectPressureByteRangesAtForecastHour,
} from "../src/grib/index.js";

const indexText = [
  "1:0:d=2026081906:TMP:850 mb:6 hour fcst:",
  "2:8:d=2026081906:RH:850 mb:6 hour fcst:",
  "3:16:d=2026081906:UGRD:850 mb:6 hour fcst:",
  "4:24:d=2026081906:VGRD:850 mb:6 hour fcst:",
  "5:32:d=2026081906:TMP:700 mb:6 hour fcst:",
  "6:40:d=2026081906:UGRD:700 mb:6 hour fcst:",
  "7.1:48:d=2026081906:TMP:500 mb:6 hour fcst:",
  "7.2:48:d=2026081906:RH:500 mb:6 hour fcst:",
  "8:56:d=2026081906:HGT:surface:6 hour fcst:",
].join("\n");

describe("parseGribIndex", () => {
  it("parses standard inventory fields and pressure levels", () => {
    const records = parseGribIndex(indexText);
    expect(records[0]).toEqual({
      message: "1", startByte: 0, variable: "TMP", level: "850 mb", pressureHpa: 850,
      raw: "1:0:d=2026081906:TMP:850 mb:6 hour fcst:",
    });
    expect(records.at(-1)?.pressureHpa).toBeUndefined();
  });

  it("preserves submessage identifiers and duplicate byte offsets", () => {
    const records = parseGribIndex(indexText);
    expect(records[6]?.message).toBe("7.1");
    expect(records[7]?.message).toBe("7.2");
    expect(records[6]?.startByte).toBe(records[7]?.startByte);
  });

  it("ignores blank trailing lines", () => {
    expect(parseGribIndex(`${indexText}\n\n`)).toHaveLength(9);
  });

  it.each([
    "garbage",
    "1:not-a-byte:d=2026081906:TMP:850 mb:6 hour fcst:",
    ":0:d=2026081906:TMP:850 mb:6 hour fcst:",
  ])("rejects malformed inventory line %s", (line) => {
    expect(() => parseGribIndex(line)).toThrow(/Malformed GRIB index line/);
  });
});

describe("selectPressureByteRanges", () => {
  const records = parseGribIndex(indexText);

  it("selects exact variables and pressure levels and derives inclusive ends", () => {
    expect(selectPressureByteRanges(records, ["TMP", "RH"], [850])).toEqual([
      { start: 0, end: 7 }, { start: 8, end: 15 },
    ]);
  });

  it("deduplicates submessages that share the same GRIB message offset", () => {
    expect(selectPressureByteRanges(records, ["TMP", "RH"], [500])).toEqual([{ start: 48, end: 55 }]);
  });

  it("uses an open-ended range when the selected field is the final GRIB message", () => {
    const recordsWithFinalPressure = parseGribIndex([
      "1:0:d=2026081906:HGT:surface:6 hour fcst:",
      "2:8:d=2026081906:TMP:500 mb:6 hour fcst:",
    ].join("\n"));
    expect(selectPressureByteRanges(recordsWithFinalPressure, ["TMP"], [500])).toEqual([{ start: 8 }]);
  });

  it("requires the complete variable × pressure-level cross-product", () => {
    expect(selectPressureByteRanges(records, ["TMP", "UGRD"], [700, 850])).toEqual([
      { start: 0, end: 7 }, { start: 16, end: 23 }, { start: 32, end: 39 }, { start: 40, end: 47 },
    ]);
  });

  it("fails with exact missing variable-level combinations", () => {
    expect(() => selectPressureByteRanges(records, ["CAPE"], [850])).toThrow(/CAPE@850mb/);
    expect(() => selectPressureByteRanges(records, ["TMP"], [925])).toThrow(/TMP@925mb/);
    expect(() => selectPressureByteRanges(records, ["TMP", "UGRD"], [500])).toThrow(/UGRD@500mb/);
  });
});


describe("selectAllPressureByteRanges", () => {
  const records = parseGribIndex(indexText);

  it("selects every isobaric message for the requested variables", () => {
    expect(selectAllPressureByteRanges(records, ["TMP"])).toEqual([
      { start: 0, end: 7 },
      { start: 32, end: 39 },
      { start: 48, end: 55 },
    ]);
  });

  it("fails when no isobaric messages match", () => {
    expect(() => selectAllPressureByteRanges(records, ["CAPE"])).toThrow(
      /no isobaric messages for: CAPE/,
    );
    // HGT only appears as surface in the fixture inventory.
    expect(() => selectAllPressureByteRanges(records, ["HGT"])).toThrow(
      /no isobaric messages for: HGT/,
    );
  });
});

describe("selectNamedLevelByteRanges", () => {
  const records = parseGribIndex([
    "1:0:d=2026081906:TMP:850 mb:anl:",
    "2:8:d=2026081906:TMP:2 m above ground:anl:",
    "3:16:d=2026081906:TMP:80 m above ground:anl:",
    "4:24:d=2026081906:PRES:surface:anl:",
    "5:32:d=2026081906:PWAT:entire atmosphere (considered as a single layer):anl:",
  ].join("\n"));

  it("selects an exact named level", () => {
    expect(selectNamedLevelByteRanges(records, [
      { gfsCode: "PRES", gribLevel: "surface" },
    ])).toEqual([{ start: 24, end: 31 }]);
  });

  it("selects every non-isobaric level when gribLevel is omitted", () => {
    expect(selectNamedLevelByteRanges(records, [{ gfsCode: "TMP" }])).toEqual([
      { start: 8, end: 15 },
      { start: 16, end: 23 },
    ]);
  });

  it("reports missing named selectors", () => {
    expect(() => selectNamedLevelByteRanges(records, [
      { gfsCode: "TMP", gribLevel: "10 m above ground" },
    ])).toThrow(/TMP@10 m above ground/);
    expect(() => selectNamedLevelByteRanges(records, [
      { gfsCode: "RH" },
    ])).toThrow(/RH@\*/);
  });
});

describe("selectNonIsobaricByteRangesAtForecastHour", () => {
  it("selects one lead from a retrospective multi-lead variable file without swallowing the next message", () => {
    const records = parseGribIndex([
      "1:0:d=2017031400:TMP:2 m above ground:3 hour fcst:",
      "2:100:d=2017031400:TMP:2 m above ground:6 hour fcst:",
      "3:210:d=2017031400:TMP:2 m above ground:9 hour fcst:",
      "4:330:d=2017031400:TMP:2 m above ground:12 hour fcst:",
      "5:460:d=2017031400:TMP:2 m above ground:15 hour fcst:",
    ].join("\n"));

    expect(selectNonIsobaricByteRangesAtForecastHour(records, [{
      id: "temperature_2m",
      gfsCode: "TMP",
      level: { gribLevel: "2 m above ground" },
      temporalSemantics: "instantaneous",
    }], 12)).toEqual([{ start: 330, end: 459 }]);
  });

  it("matches the end hour of accumulated and averaged messages", () => {
    const records = parseGribIndex([
      "1:0:d=2017031400:APCP:surface:0-3 hour acc fcst:",
      "2:100:d=2017031400:APCP:surface:3-6 hour acc fcst:",
      "3:200:d=2017031400:TCDC:entire atmosphere:3-6 hour ave fcst:",
      "4:300:d=2017031400:TCDC:entire atmosphere:6-9 hour ave fcst:",
    ].join("\n"));

    expect(selectNonIsobaricByteRangesAtForecastHour(records, [{
      id: "total_precipitation",
      gfsCode: "APCP",
      level: { gribLevel: "surface" },
      temporalSemantics: "accumulation",
    }], 6)).toEqual([{ start: 100, end: 199 }]);

    expect(selectNonIsobaricByteRangesAtForecastHour(records, [{
      id: "total_atmosphere_cloud_cover",
      gfsCode: "TCDC",
      level: { gribLevel: "entire atmosphere" },
      temporalSemantics: "average",
    }], 6)).toEqual([{ start: 200, end: 299 }]);
  });
});


describe("selectPressureByteRangesAtForecastHour", () => {
  it("selects pressure messages for one lead from a retrospective multi-lead variable file", () => {
    const records = parseGribIndex([
      "1:0:d=2017031400:TMP:850 mb:9 hour fcst:",
      "2:100:d=2017031400:TMP:500 mb:9 hour fcst:",
      "3:200:d=2017031400:TMP:850 mb:12 hour fcst:",
      "4:310:d=2017031400:TMP:500 mb:12 hour fcst:",
      "5:430:d=2017031400:TMP:850 mb:15 hour fcst:",
    ].join("\n"));

    expect(selectPressureByteRangesAtForecastHour(
      records, ["TMP"], [850, 500], 12,
    )).toEqual([
      { start: 200, end: 309 },
      { start: 310, end: 429 },
    ]);
  });

  it("reports a missing variable-level pair at the requested lead", () => {
    const records = parseGribIndex([
      "1:0:d=2017031400:TMP:850 mb:9 hour fcst:",
      "2:100:d=2017031400:TMP:500 mb:12 hour fcst:",
    ].join("\n"));
    expect(() => selectPressureByteRangesAtForecastHour(
      records, ["TMP"], [850], 12,
    )).toThrow(/TMP@850mb@f12/);
  });
});
