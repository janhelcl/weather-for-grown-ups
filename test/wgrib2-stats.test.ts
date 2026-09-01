import { describe, expect, it, vi } from "vitest";
import {
  parseSelectedAreaInventoryLine,
  parseWgrib2StatsLine,
  Wgrib2StatsDecoder,
  type Wgrib2CommandRunner,
} from "../src/grib/wgrib2-stats.js";

const box = { westLongitude: -10, eastLongitude: 20, southLatitude: 40, northLatitude: 50 };

describe("parseWgrib2StatsLine", () => {
  it("parses defined counts and scalar statistics including scientific notation", () => {
    expect(parseWgrib2StatsLine("1:0:ndata=100:undef=20:mean=-1.2e-2:min=-3:max=4.5:cos_wt_mean=0")).toEqual({
      totalGridPoints: 100, undefinedGridPoints: 20, definedGridPoints: 80, mean: -0.012, min: -3, max: 4.5,
    });
  });

  it("returns null for incomplete or undefined statistics", () => {
    expect(parseWgrib2StatsLine("1:0:ndata=100:undef=0:mean=5:min=undefined:max=9")).toBeNull();
    expect(parseWgrib2StatsLine("noise")).toBeNull();
  });
});

describe("parseSelectedAreaInventoryLine", () => {
  const lowCloudInstant = {
    code: "LCDC" as const,
    gribLevel: "low cloud layer",
    temporalSemantics: "instantaneous" as const,
  };

  it("distinguishes instantaneous from average records at the same variable and named layer", () => {
    expect(parseSelectedAreaInventoryLine(
      "17:1000:d=2026081912:LCDC:low cloud layer:6 hour fcst:",
      lowCloudInstant,
    )).toEqual({ record: 17, temporal: { type: "instantaneous" } });

    expect(parseSelectedAreaInventoryLine(
      "18:2000:d=2026081912:LCDC:low cloud layer:3-6 hour ave fcst:",
      lowCloudInstant,
    )).toBeNull();

    expect(parseSelectedAreaInventoryLine(
      "18:2000:d=2026081912:LCDC:low cloud layer:3-6 hour ave fcst:",
      { ...lowCloudInstant, temporalSemantics: "average" },
    )).toEqual({
      record: 18,
      temporal: { type: "average", startForecastHour: 3, endForecastHour: 6 },
    });
  });

  it("normalizes DWD VMAX_10M and preserves hourly maximum semantics", () => {
    expect(parseSelectedAreaInventoryLine(
      "52:9000:d=2026081912:VMAX_10M:10 m above ground:5-6 hour max fcst:",
      { code: "GUST", gribLevel: "10 m above ground", temporalSemantics: "maximum" },
    )).toEqual({
      record: 52,
      temporal: { type: "maximum", startForecastHour: 5, endForecastHour: 6 },
    });
  });

  it("parses accumulation intervals and rejects wrong vertical semantics", () => {
    expect(parseSelectedAreaInventoryLine(
      "41:5000:d=2026081912:APCP:surface:0-6 hour acc fcst:",
      { code: "APCP", gribLevel: "surface", temporalSemantics: "accumulation" },
    )).toEqual({
      record: 41,
      temporal: { type: "accumulation", startForecastHour: 0, endForecastHour: 6 },
    });
    expect(parseSelectedAreaInventoryLine(
      "41:5000:d=2026081912:APCP:surface:0-6 hour acc fcst:",
      { code: "APCP", gribLevel: "2 m above ground", temporalSemantics: "accumulation" },
    )).toBeNull();
  });
});

describe("Wgrib2StatsDecoder", () => {
  it("undefines outside the bbox before stats and normalizes western longitudes to 0..360", async () => {
    const runner = vi.fn(async () => ({ stdout: "1:0:ndata=100:undef=20:mean=280:min=270:max=290" }));
    const result = await new Wgrib2StatsDecoder("/opt/wgrib2", runner).summarizeBox("/tmp/a.grib2", box);
    expect(runner).toHaveBeenCalledWith("/opt/wgrib2", [
      "/tmp/a.grib2", "-s", "-undefine", "out-box", "350:20", "40:50", "-stats",
    ]);
    expect(result.definedGridPoints).toBe(80);
  });

  it("selects exactly one non-isobaric record before calculating area statistics", async () => {
    const runner = vi.fn(async (_executable: string, args: string[]) => {
      if (args.includes("-d")) {
        return { stdout: "18:0:ndata=100:undef=10:mean=55:min=20:max=95" };
      }
      return {
        stdout: [
          "17:1000:d=2026081912:LCDC:low cloud layer:6 hour fcst:",
          "18:2000:d=2026081912:LCDC:low cloud layer:3-6 hour ave fcst:",
        ].join("\n"),
      };
    });
    const result = await new Wgrib2StatsDecoder("/opt/wgrib2", runner).summarizeSelectedMessage(
      "/tmp/cloud.grib2",
      box,
      { code: "LCDC", gribLevel: "low cloud layer", temporalSemantics: "average" },
    );

    expect(runner).toHaveBeenNthCalledWith(1, "/opt/wgrib2", ["/tmp/cloud.grib2", "-s"]);
    expect(runner).toHaveBeenNthCalledWith(2, "/opt/wgrib2", [
      "/tmp/cloud.grib2", "-d", "18", "-undefine", "out-box", "350:20", "40:50", "-stats",
    ]);
    expect(result).toEqual({
      totalGridPoints: 100,
      undefinedGridPoints: 10,
      definedGridPoints: 90,
      mean: 55,
      min: 20,
      max: 95,
      temporal: { type: "average", startForecastHour: 3, endForecastHour: 6 },
    });
  });

  it("rejects missing or ambiguous selected records", async () => {
    const noMatch: Wgrib2CommandRunner = async () => ({
      stdout: "1:0:d=2026081912:TCDC:entire atmosphere:6 hour fcst:",
    });
    await expect(new Wgrib2StatsDecoder("wgrib2", noMatch).summarizeSelectedMessage(
      "x.grib2",
      box,
      { code: "LCDC", gribLevel: "low cloud layer", temporalSemantics: "instantaneous" },
    )).rejects.toThrow(/did not contain LCDC/);

    const ambiguous: Wgrib2CommandRunner = async () => ({
      stdout: [
        "1:0:d=2026081912:LCDC:low cloud layer:6 hour fcst:",
        "2:100:d=2026081912:LCDC:low cloud layer:6 hour fcst:",
      ].join("\n"),
    });
    await expect(new Wgrib2StatsDecoder("wgrib2", ambiguous).summarizeSelectedMessage(
      "x.grib2",
      box,
      { code: "LCDC", gribLevel: "low cloud layer", temporalSemantics: "instantaneous" },
    )).rejects.toThrow(/2 matching records/);
  });

  it("rejects boxes with no defined grid points", async () => {
    const runner: Wgrib2CommandRunner = async () => ({ stdout: "1:0:ndata=100:undef=100:mean=0:min=0:max=0" });
    await expect(new Wgrib2StatsDecoder("wgrib2", runner).summarizeBox("x.grib2", box)).rejects.toThrow(/no defined GFS grid points/);
  });

  it("fails clearly when no stats line can be parsed", async () => {
    const runner: Wgrib2CommandRunner = async () => ({ stdout: "nonsense" });
    await expect(new Wgrib2StatsDecoder("wgrib2", runner).summarizeBox("x.grib2", box)).rejects.toThrow(/no usable area statistics/);
  });

  it("translates ENOENT to an actionable wgrib2 error", async () => {
    const runner: Wgrib2CommandRunner = async () => { throw new Error("spawn wgrib2 ENOENT"); };
    await expect(new Wgrib2StatsDecoder("wgrib2", runner).summarizeBox("x.grib2", box)).rejects.toThrow(/wgrib2 is required but was not found/);
  });

  it("rethrows other process errors", async () => {
    const error = new Error("bad grib");
    const runner: Wgrib2CommandRunner = async () => { throw error; };
    await expect(new Wgrib2StatsDecoder("wgrib2", runner).summarizeBox("x.grib2", box)).rejects.toBe(error);
  });
});
