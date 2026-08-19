import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseWgrib2StatsLine, Wgrib2StatsDecoder } from "../src/grib/wgrib2-stats.js";

vi.mock("execa", () => ({ execa: vi.fn() }));
const execaMock = vi.mocked(execa);
beforeEach(() => execaMock.mockReset());

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
    execaMock.mockResolvedValue({ stdout: "1:0:ndata=100:undef=20:mean=280:min=270:max=290" } as never);
    const result = await new Wgrib2StatsDecoder("/opt/wgrib2").summarizeBox("/tmp/a.grib2", {
      westLongitude: -10, eastLongitude: 20, southLatitude: 40, northLatitude: 50,
    });
    expect(execaMock).toHaveBeenCalledWith("/opt/wgrib2", [
      "/tmp/a.grib2", "-s", "-undefine", "out-box", "350:20", "40:50", "-stats",
    ]);
    expect(result.definedGridPoints).toBe(80);
  });

  it("rejects boxes with no defined grid points", async () => {
    execaMock.mockResolvedValue({ stdout: "1:0:ndata=100:undef=100:mean=0:min=0:max=0" } as never);
    await expect(new Wgrib2StatsDecoder().summarizeBox("x.grib2", { westLongitude: 0, eastLongitude: 1, southLatitude: 0, northLatitude: 1 })).rejects.toThrow(/no defined GFS grid points/);
  });

  it("fails clearly when no stats line can be parsed", async () => {
    execaMock.mockResolvedValue({ stdout: "nonsense" } as never);
    await expect(new Wgrib2StatsDecoder().summarizeBox("x.grib2", { westLongitude: 0, eastLongitude: 1, southLatitude: 0, northLatitude: 1 })).rejects.toThrow(/no usable area statistics/);
  });

  it("translates ENOENT to an actionable wgrib2 error", async () => {
    execaMock.mockRejectedValue(new Error("spawn wgrib2 ENOENT"));
    await expect(new Wgrib2StatsDecoder().summarizeBox("x.grib2", { westLongitude: 0, eastLongitude: 1, southLatitude: 0, northLatitude: 1 })).rejects.toThrow(/wgrib2 is required/);
  });

  it("rethrows other process errors", async () => {
    const error = new Error("bad grib");
    execaMock.mockRejectedValue(error);
    await expect(new Wgrib2StatsDecoder().summarizeBox("x.grib2", { westLongitude: 0, eastLongitude: 1, southLatitude: 0, northLatitude: 1 })).rejects.toBe(error);
  });
});
