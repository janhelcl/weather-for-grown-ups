import { describe, expect, it } from "vitest";
import { parseGribIndex, selectPressureByteRanges } from "../src/grib/index.js";

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
