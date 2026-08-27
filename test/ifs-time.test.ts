import { describe, expect, it } from "vitest";
import {
  ifsForecastHour,
  ifsMaxForecastHour,
  isNativeIfsForecastHour,
  latestIfsCycleAtOrBefore,
  parseIfsRun,
} from "../src/core/ifs-time.js";

describe("IFS native run semantics", () => {
  it("uses long 00/12Z and short 06/18Z forecast horizons", () => {
    const longRun = new Date("2026-08-27T12:00:00Z");
    const shortRun = new Date("2026-08-27T18:00:00Z");
    expect(ifsMaxForecastHour(longRun)).toBe(360);
    expect(ifsMaxForecastHour(shortRun)).toBe(144);
    expect(isNativeIfsForecastHour(longRun, 144)).toBe(true);
    expect(isNativeIfsForecastHour(longRun, 147)).toBe(false);
    expect(isNativeIfsForecastHour(longRun, 150)).toBe(true);
    expect(isNativeIfsForecastHour(longRun, 360)).toBe(true);
    expect(isNativeIfsForecastHour(shortRun, 144)).toBe(true);
    expect(isNativeIfsForecastHour(shortRun, 150)).toBe(false);
  });

  it("validates forecast valid times against the selected run cadence", () => {
    const run = new Date("2026-08-27T12:00:00Z");
    expect(ifsForecastHour(run, new Date("2026-08-27T18:00:00Z"))).toBe(6);
    expect(() => ifsForecastHour(run, new Date(run.getTime() + 147 * 3_600_000)))
      .toThrow("does not publish f147");
  });

  it("requires exact synoptic initialization cycles", () => {
    expect(parseIfsRun("2026-08-27T06:00:00Z").toISOString()).toBe("2026-08-27T06:00:00.000Z");
    expect(() => parseIfsRun("2026-08-27T09:00:00Z")).toThrow("00/06/12/18");
    expect(latestIfsCycleAtOrBefore(new Date("2026-08-27T17:59:00Z")).toISOString())
      .toBe("2026-08-27T12:00:00.000Z");
  });
});
