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

  it("checks the selected deterministic 0.5 grid when aligning with GEFS", async () => {
    const calls: any[] = [];
    const resolver = new GfsGefsAlignedRunResolver({
      now: () => new Date("2026-08-23T19:00:00Z"),
      gfsProbe: {
        isRunComplete: async () => true,
        isForecastAvailable: async (...args: any[]) => {
          calls.push(args);
          return true;
        },
      },
      gefsProbe: { areMembersAvailable: async () => true },
    });

    await resolver.resolveLatestAlignedRun(
      new Date("2026-08-23T18:00:00Z"),
      "TMP",
      850,
      ["c00", "p01"],
      "0p50",
    );
    expect(calls[0]?.[3]).toBe("0p50");
  });

  it("continues to an older aligned cycle when deterministic GFS is missing", async () => {
    let calls = 0;
    const resolver = new GfsGefsAlignedRunResolver({
      now: () => new Date("2026-08-23T19:00:00Z"),
      gfsProbe: {
        isRunComplete: async () => true,
        isForecastAvailable: async () => {
          calls += 1;
          return calls > 1;
        },
      },
      gefsProbe: { areMembersAvailable: async () => true },
    });
    const run = await resolver.resolveLatestAlignedRun(
      new Date("2026-08-23T18:00:00Z"),
      "TMP",
      850,
      ["c00", "p01"],
    );
    expect(run.toISOString()).toBe("2026-08-23T12:00:00.000Z");
    expect(calls).toBe(2);
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
