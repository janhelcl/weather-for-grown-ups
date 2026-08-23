import { describe, expect, it } from "vitest";
import { GefsLatestRunResolver } from "../src/core/gefs-latest-run.js";

describe("GEFS range-aware latest-run resolution", () => {
  it("walks older cycles until both range endpoints exist for every selected member", async () => {
    const calls: Array<{ run: string; forecastHour: number }> = [];
    const resolver = new GefsLatestRunResolver({
      now: () => new Date("2026-08-23T14:20:00Z"),
      probe: {
        areMembersAvailable: async (run, forecastHour, members) => {
          expect(members).toEqual(["c00", "p01"]);
          calls.push({ run: run.toISOString(), forecastHour });
          if (run.toISOString() === "2026-08-23T12:00:00.000Z") return forecastHour === 3;
          return run.toISOString() === "2026-08-23T06:00:00.000Z";
        },
      },
    });

    const run = await resolver.resolveLatestRunRange(
      new Date("2026-08-23T15:00:00Z"),
      new Date("2026-08-23T18:00:00Z"),
      ["c00", "p01"],
    );

    expect(run.toISOString()).toBe("2026-08-23T06:00:00.000Z");
    expect(calls).toEqual([
      { run: "2026-08-23T12:00:00.000Z", forecastHour: 3 },
      { run: "2026-08-23T12:00:00.000Z", forecastHour: 6 },
      { run: "2026-08-23T06:00:00.000Z", forecastHour: 9 },
      { run: "2026-08-23T06:00:00.000Z", forecastHour: 12 },
    ]);
  });

  it("anchors at the first valid time so the selected run can never start after the range", async () => {
    const seen: string[] = [];
    const resolver = new GefsLatestRunResolver({
      now: () => new Date("2026-08-24T12:00:00Z"),
      probe: {
        areMembersAvailable: async (run) => {
          seen.push(run.toISOString());
          return true;
        },
      },
    });

    const run = await resolver.resolveLatestRunRange(
      new Date("2026-08-23T09:00:00Z"),
      new Date("2026-08-23T15:00:00Z"),
      ["c00", "p01"],
    );

    expect(run.toISOString()).toBe("2026-08-23T06:00:00.000Z");
    expect(seen[0]).toBe("2026-08-23T06:00:00.000Z");
  });
});
