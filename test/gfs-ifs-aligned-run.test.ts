import { describe, expect, it } from "vitest";
import { GfsIfsAlignedRunResolver } from "../src/core/gfs-ifs-aligned-run.js";

describe("GfsIfsAlignedRunResolver", () => {
  it("walks backward until both deterministic models publish the requested selection", async () => {
    const gfsCalls: string[] = [];
    const ifsCalls: string[] = [];
    const resolver = new GfsIfsAlignedRunResolver({
      now: () => new Date("2026-08-28T10:00:00Z"),
      gfsProbe: {
        isRunComplete: async () => true,
        isForecastAvailable: async (run, forecastHour, selection) => {
          gfsCalls.push(`${run.toISOString()}:f${forecastHour}:${selection.variableCodes.join(",")}@${selection.pressureLevelsHpa.join(",")}`);
          return true;
        },
      },
      ifsProbe: {
        isForecastAvailable: async (run, forecastHour, selectors) => {
          ifsCalls.push(`${run.toISOString()}:f${forecastHour}:${selectors.map((selector) => selector.param).join(",")}`);
          return run.toISOString() === "2026-08-28T00:00:00.000Z";
        },
      },
    });

    const run = await resolver.resolveLatestAlignedRun(
      new Date("2026-08-28T09:00:00Z"),
      "temperature",
      850,
    );

    expect(run.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(gfsCalls).toEqual([
      "2026-08-28T06:00:00.000Z:f3:TMP@850",
      "2026-08-28T00:00:00.000Z:f9:TMP@850",
    ]);
    expect(ifsCalls).toEqual([
      "2026-08-28T06:00:00.000Z:f3:t",
      "2026-08-28T00:00:00.000Z:f9:t",
    ]);
  });

  it("aligns derived-variable dependencies rather than probing a fake derived GRIB field", async () => {
    const gfsSelections: string[][] = [];
    const ifsSelections: string[][] = [];
    const resolver = new GfsIfsAlignedRunResolver({
      now: () => new Date("2026-08-28T10:00:00Z"),
      gfsProbe: {
        isRunComplete: async () => true,
        isForecastAvailable: async (_run, _forecastHour, selection) => {
          gfsSelections.push([...selection.variableCodes]);
          return true;
        },
      },
      ifsProbe: {
        isForecastAvailable: async (_run, _forecastHour, selectors) => {
          ifsSelections.push(selectors.map((selector) => selector.param));
          return true;
        },
      },
    });

    await resolver.resolveLatestAlignedRun(
      new Date("2026-08-28T09:00:00Z"),
      "wind",
      850,
      "0p50",
    );

    expect(gfsSelections[0]).toEqual(["UGRD", "VGRD"]);
    expect(ifsSelections[0]).toEqual(["u", "v"]);
  });
  it("skips an IFS short cycle that cannot reach the valid time and uses the older long cycle", async () => {
    const gfsRuns: string[] = [];
    const ifsRuns: string[] = [];
    const resolver = new GfsIfsAlignedRunResolver({
      now: () => new Date("2026-08-28T06:00:00Z"),
      gfsProbe: {
        isRunComplete: async () => true,
        isForecastAvailable: async (run) => {
          gfsRuns.push(run.toISOString());
          return true;
        },
      },
      ifsProbe: {
        isForecastAvailable: async (run) => {
          ifsRuns.push(run.toISOString());
          return true;
        },
      },
    });

    const run = await resolver.resolveLatestAlignedRun(
      new Date("2026-09-03T12:00:00Z"),
      "temperature",
      850,
    );

    expect(run.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(gfsRuns).toEqual(["2026-08-28T00:00:00.000Z"]);
    expect(ifsRuns).toEqual(["2026-08-28T00:00:00.000Z"]);
  });

  it("fails explicitly when no common cycle publishes the requested selection", async () => {
    const resolver = new GfsIfsAlignedRunResolver({
      now: () => new Date("2026-08-28T10:00:00Z"),
      maxCandidates: 2,
      gfsProbe: {
        isRunComplete: async () => true,
        isForecastAvailable: async () => false,
      },
      ifsProbe: {
        isForecastAvailable: async () => true,
      },
    });

    await expect(resolver.resolveLatestAlignedRun(
      new Date("2026-08-28T09:00:00Z"),
      "temperature",
      850,
    )).rejects.toThrow("No aligned GFS/IFS cycle");
  });

});
