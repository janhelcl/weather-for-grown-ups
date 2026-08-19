import { describe, expect, it } from "vitest";
import { parseGribIndex, selectPressureByteRanges } from "../src/grib/index.js";

const indexText = [
  "1:0:d=2026081906:TMP:850 mb:6 hour fcst:",
  "2:8:d=2026081906:RH:850 mb:6 hour fcst:",
  "3:16:d=2026081906:UGRD:850 mb:6 hour fcst:",
  "4:24:d=2026081906:VGRD:850 mb:6 hour fcst:",
  "5:32:d=2026081906:TMP:700 mb:6 hour fcst:",
  "6.1:40:d=2026081906:TMP:500 mb:6 hour fcst:",
  "6.2:40:d=2026081906:RH:500 mb:6 hour fcst:",
  "7:48:d=2026081906:HGT:surface:6 hour fcst:",
].join("\n");

describe("parseGribIndex", () => {
  it("parses standard wgrib2 inventory fields and pressure levels", () => {
    const records = parseGribIndex(indexText);
    expect(records[0]).toEqual({
      message: "1",
      startByte: 0,
      variable: "TMP",
      level: "850 mb",
      pressureHpa: 850,
      raw: "1:0:d=2026081906:TMP:850 mb:6 hour fcst:",
    });
    expect(records[7]?.pressureHpa).toBeUndefined();
  });

  it("preserves submessage identifiers and duplicate byte offsets", () => {
    const records = parseGribIndex(indexText);
    expect(records[5]?.message).toBe("6.1");
    expect(records[6]?.message).toBe("6.2");
    expect(records[5]?.startByte).toBe(records[6]?.startByte);
  });

  it("ignores blank trailing lines", () => {
    expect(parseGribIndex(`${indexText}\n\n`)).toHaveLength(8);
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
      { start: 0, end: 7 },
      { start: 8, end: 15 },
    ]);
  });

  it("deduplicates submessages that share the same GRIB message offset", () => {
    expect(selectPressureByteRanges(records, ["TMP", "RH"], [500])).toEqual([
      { start: 40, end: 47 },
    ]);
  });

  it("uses an open-ended range when the selected field is the final GRIB message", () => {
    const finalPressureRecord = parseGribIndex([
      "1:0:d=2026081906:HGT:surface:6 hour fcst:",
      "2:8:d=2026081906:TMP:500 mb:6 hour fcst:",
    ].join("\n"));
    expect(selectPressureByteRanges(finalPressureRecord, ["TMP"], [500])).toEqual([{ start: 8 }]);
  });

  it("returns ranges in file order regardless of query ordering", () => {
    expect(selectPressureByteRanges(records, ["TMP", "UGRD"], [700, 850])).toEqual([
      { start: 0, end: 7 },
      { start: 16, end: 23 },
      { start: 32, end: 39 },
    ]);
  });

  it("fails clearly when no requested pressure-level field exists", () => {
    expect(() => selectPressureByteRanges(records, ["CAPE"], [850])).toThrow(/No matching pressure-level fields/);
    expect(() => selectPressureByteRanges(records, ["TMP"], [925])).toThrow(/No matching pressure-level fields/);
  });
});
