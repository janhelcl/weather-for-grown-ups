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
});
