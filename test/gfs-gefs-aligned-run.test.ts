import { describe, expect, it } from "vitest";
import { GfsGefsAlignedRunResolver } from "../src/core/gfs-gefs-aligned-run.js";

describe("GfsGefsAlignedRunResolver", () => {
  it("walks backward until both deterministic GFS and all GEFS members are available from one cycle", async () => {
    const gfsCalls: string[] = [];
    const gefsCalls: string[] = [];
    const resolver = new GfsGefsAlignedRunResolver({
      now: () => new Date("2026-08-23T19:00:00Z"),
      gfsProbe: {
        isRunComplete: async () => true,
        isForecastAvailable: async (run, forecastHour, selection) => {
          gfsCalls.push(`${run.toISOString()}:f${forecastHour}:${selection.variableCodes.join(",")}@${selection.pressureLevelsHpa.join(",")}`);
          return true;
        },
      },
      gefsProbe: {
        areMembersAvailable: async (run, forecastHour, members) => {
          gefsCalls.push(`${run.toISOString()}:f${forecastHour}:${members.join(",")}`);
          return run.toISOString() === "2026-08-23T12:00:00.000Z";
        },
      },
    });

    const run = await resolver.resolveLatestAlignedRun(
      new Date("2026-08-23T18:00:00Z"),
      "TMP",
      850,
      ["c00", "p01", "p02"],
    );

    expect(run.toISOString()).toBe("2026-08-23T12:00:00.000Z");
    expect(gfsCalls).toEqual([
      "2026-08-23T18:00:00.000Z:f0:TMP@850",
      "2026-08-23T12:00:00.000Z:f6:TMP@850",
    ]);
    expect(gefsCalls).toEqual([
      "2026-08-23T18:00:00.000Z:f0:c00,p01,p02",
      "2026-08-23T12:00:00.000Z:f6:c00,p01,p02",
    ]);
  });

  it("rejects valid times that are not on the shared GEFS three-hour cadence", async () => {
    const resolver = new GfsGefsAlignedRunResolver({
      now: () => new Date("2026-08-23T19:00:00Z"),
      gfsProbe: { isRunComplete: async () => true, isForecastAvailable: async () => true },
      gefsProbe: { areMembersAvailable: async () => true },
      maxCandidates: 2,
    });

    await expect(resolver.resolveLatestAlignedRun(
      new Date("2026-08-23T17:00:00Z"),
      "TMP",
      850,
      ["c00", "p01"],
    )).rejects.toThrow("every 3 hours");
  });
});
