import { describe, expect, it, vi } from "vitest";
import { parseWgrib2Spread, Wgrib2GridDecoder } from "../src/grib/wgrib2-grid.js";

const box = { westLongitude: -10, eastLongitude: 20, southLatitude: 40, northLatitude: 50 };

describe("parseWgrib2Spread", () => {
  it("parses defined lon/lat/value rows and normalizes longitude", () => {
    expect(parseWgrib2Spread([
      "lon,lat,TMP 850 mb",
      "350,50,280",
      "20,40,-1.2e-2",
      "10,45,9.999e20",
      "noise",
    ].join("\n"))).toEqual([
      { longitude: -10, latitude: 50, value: 280 },
      { longitude: 20, latitude: 40, value: -0.012 },
    ]);
  });
});

describe("Wgrib2GridDecoder", () => {
  it("requires one pressure record then extracts only the bounded box with spread-to-stdout", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "1:0:d=2026082406:TMP:850 mb:6 hour fcst:" })
      .mockResolvedValueOnce({ stdout: "lon,lat,TMP\n350,50,280\n20,40,290" });
    const decoder = new Wgrib2GridDecoder("/opt/wgrib2", runner);
    expect(await decoder.extractBox("/tmp/a.grib2", box)).toEqual([
      { longitude: -10, latitude: 50, value: 280 },
      { longitude: 20, latitude: 40, value: 290 },
    ]);
    expect(runner.mock.calls[1]?.[1]).toEqual([
      "/tmp/a.grib2", "-d", "1", "-undefine", "out-box", "350:20", "40:50", "-spread", "-",
    ]);
  });

  it("selects exact non-isobaric temporal semantics before extracting values", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: [
        "1:0:d=2026082406:LCDC:low cloud layer:6 hour fcst:",
        "2:1:d=2026082406:LCDC:low cloud layer:0-6 hour ave fcst:",
      ].join("\n") })
      .mockResolvedValueOnce({ stdout: "lon,lat,LCDC\n10,50,25\n11,50,75" });
    const result = await new Wgrib2GridDecoder("wgrib2", runner).extractSelectedMessage("x.grib2", box, {
      code: "LCDC",
      gribLevel: "low cloud layer",
      temporalSemantics: "average",
    });
    expect(result.temporal).toEqual({ type: "average", startForecastHour: 0, endForecastHour: 6 });
    expect(result.points).toHaveLength(2);
    expect(runner.mock.calls[1]?.[1]?.slice(0, 3)).toEqual(["x.grib2", "-d", "2"]);
  });

  it("rejects ambiguous or empty selections and translates ENOENT", async () => {
    const multiple = vi.fn(async () => ({ stdout: "1:0:d=x:TMP:850 mb:x\n2:1:d=x:TMP:850 mb:x" }));
    await expect(new Wgrib2GridDecoder("wgrib2", multiple).extractBox("x", box)).rejects.toThrow(/exactly one GRIB record/);

    const emptySpread = vi.fn()
      .mockResolvedValueOnce({ stdout: "1:0:d=x:TMP:850 mb:x" })
      .mockResolvedValueOnce({ stdout: "lon,lat,TMP" });
    await expect(new Wgrib2GridDecoder("wgrib2", emptySpread).extractBox("x", box)).rejects.toThrow(/no defined/);

    const missing = vi.fn(async () => { throw new Error("spawn wgrib2 ENOENT"); });
    await expect(new Wgrib2GridDecoder("wgrib2", missing).extractBox("x", box)).rejects.toThrow(/required but was not found/);
  });
});
