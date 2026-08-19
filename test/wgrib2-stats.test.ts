import { describe, expect, it, vi } from "vitest";
import { parseWgrib2StatsLine, Wgrib2StatsDecoder, type Wgrib2CommandRunner } from "../src/grib/wgrib2-stats.js";

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

describe("Wgrib2StatsDecoder", () => {
  it("undefines outside the bbox before stats and normalizes western longitudes to 0..360", async () => {
    const runner = vi.fn(async () => ({ stdout: "1:0:ndata=100:undef=20:mean=280:min=270:max=290" }));
    const result = await new Wgrib2StatsDecoder("/opt/wgrib2", runner).summarizeBox("/tmp/a.grib2", box);
    expect(runner).toHaveBeenCalledWith("/opt/wgrib2", [
      "/tmp/a.grib2", "-s", "-undefine", "out-box", "350:20", "40:50", "-stats",
    ]);
    expect(result.definedGridPoints).toBe(80);
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
