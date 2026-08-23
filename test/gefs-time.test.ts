import { describe, expect, it } from "vitest";
import { GefsLatestRunResolver } from "../src/core/gefs-latest-run.js";
import { gefsForecastHour, latestGefsCycleAtOrBefore, parseGefsRun } from "../src/core/gefs-time.js";

const run = new Date("2026-08-23T12:00:00Z");

describe("GEFS time semantics", () => {
  it("accepts the four synoptic cycles", () => {
    expect(parseGefsRun("2026-08-23T00:00:00Z").getUTCHours()).toBe(0);
    expect(parseGefsRun("2026-08-23T18:00:00Z").getUTCHours()).toBe(18);
    expect(() => parseGefsRun("2026-08-23T03:00:00Z")).toThrow("00Z, 06Z, 12Z, or 18Z");
  });

  it("uses three-hour forecast cadence through f384", () => {
    expect(gefsForecastHour(run, new Date("2026-08-23T15:00:00Z"))).toBe(3);
    expect(gefsForecastHour(run, new Date("2026-09-08T12:00:00Z"))).toBe(384);
    expect(() => gefsForecastHour(run, new Date("2026-08-23T13:00:00Z"))).toThrow("every 3 hours");
    expect(() => gefsForecastHour(run, new Date("2026-09-08T15:00:00Z"))).toThrow("<= 384");
  });

  it("rounds a time down to its containing six-hour GEFS cycle", () => {
    expect(latestGefsCycleAtOrBefore(new Date("2026-08-23T17:59:00Z")).toISOString()).toBe("2026-08-23T12:00:00.000Z");
  });

  it("walks older cycles until every requested member is available", async () => {
    const calls: string[] = [];
    const resolver = new GefsLatestRunResolver({
      now: () => new Date("2026-08-23T14:20:00Z"),
      probe: {
        areMembersAvailable: async (candidate) => {
          calls.push(candidate.toISOString());
          return candidate.toISOString() === "2026-08-23T06:00:00.000Z";
        },
      },
    });
    const resolved = await resolver.resolveLatestRun(new Date("2026-08-23T18:00:00Z"), ["c00", "p01"]);
    expect(resolved.toISOString()).toBe("2026-08-23T06:00:00.000Z");
    expect(calls).toEqual(["2026-08-23T12:00:00.000Z", "2026-08-23T06:00:00.000Z"]);
  });
});
