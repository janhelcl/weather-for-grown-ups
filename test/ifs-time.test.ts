import { describe, expect, it } from "vitest";
import {
  ifsEnsForecastHoursInRange,
  ifsEnsMaxForecastHour,
  ifsEnsValidTimeForForecastHour,
  ifsForecastHour,
  ifsForecastHoursInRange,
  ifsMaxForecastHour,
  ifsValidTimeForForecastHour,
  isNativeIfsEnsForecastHour,
  isNativeIfsForecastHour,
  latestIfsCycleAtOrBefore,
  parseIfsRun,
} from "../src/core/ifs-time.js";

describe("IFS native run semantics", () => {
  it("uses long 00/12Z and short 06/18Z forecast horizons", () => {
    const longRun = new Date("2026-08-27T12:00:00Z");
    const shortRun = new Date("2026-08-27T18:00:00Z");
    expect(ifsMaxForecastHour(longRun)).toBe(240);
    expect(ifsMaxForecastHour(shortRun)).toBe(90);
    expect(isNativeIfsForecastHour(longRun, 144)).toBe(true);
    expect(isNativeIfsForecastHour(longRun, 147)).toBe(false);
    expect(isNativeIfsForecastHour(longRun, 150)).toBe(true);
    expect(isNativeIfsForecastHour(longRun, 240)).toBe(true);
    expect(isNativeIfsForecastHour(longRun, 246)).toBe(false);
    expect(isNativeIfsForecastHour(shortRun, 90)).toBe(true);
    expect(isNativeIfsForecastHour(shortRun, 93)).toBe(false);

    expect(ifsEnsMaxForecastHour(longRun)).toBe(360);
    expect(ifsEnsMaxForecastHour(shortRun)).toBe(144);
    expect(isNativeIfsEnsForecastHour(longRun, 360)).toBe(true);
    expect(isNativeIfsEnsForecastHour(shortRun, 144)).toBe(true);
    expect(isNativeIfsEnsForecastHour(shortRun, 150)).toBe(false);
  });

  it("validates forecast valid times against the selected run cadence", () => {
    const run = new Date("2026-08-27T12:00:00Z");
    expect(ifsForecastHour(run, new Date("2026-08-27T18:00:00Z"))).toBe(6);
    expect(() => ifsForecastHour(run, new Date(run.getTime() + 147 * 3_600_000)))
      .toThrow("does not publish f147");
  });

  it("enumerates native outputs across the 3h-to-6h cadence transition", () => {
    const run = new Date("2026-08-27T12:00:00Z");
    const start = new Date(run.getTime() + 138 * 3_600_000);
    const end = new Date(run.getTime() + 156 * 3_600_000);
    expect(ifsForecastHoursInRange(run, start, end)).toEqual([138, 141, 144, 150, 156]);
    expect(ifsValidTimeForForecastHour(run, 150).getTime() - run.getTime())
      .toBe(150 * 3_600_000);
    expect(() => ifsValidTimeForForecastHour(run, 147)).toThrow("not native");
  });

  it("enumerates the native ENS 3h-to-6h cadence transition independently of deterministic IFS", () => {
    const run = new Date("2026-08-27T12:00:00Z");
    const start = new Date(run.getTime() + 138 * 3_600_000);
    const end = new Date(run.getTime() + 156 * 3_600_000);
    expect(ifsEnsForecastHoursInRange(run, start, end)).toEqual([138, 141, 144, 150, 156]);
    expect(ifsEnsValidTimeForForecastHour(run, 156).getTime() - run.getTime())
      .toBe(156 * 3_600_000);
    expect(() => ifsEnsValidTimeForForecastHour(run, 147)).toThrow("not native");
  });

  it("requires exact synoptic initialization cycles", () => {
    expect(parseIfsRun("2026-08-27T06:00:00Z").toISOString()).toBe("2026-08-27T06:00:00.000Z");
    expect(() => parseIfsRun("2026-08-27T09:00:00Z")).toThrow("00/06/12/18");
    expect(latestIfsCycleAtOrBefore(new Date("2026-08-27T17:59:00Z")).toISOString())
      .toBe("2026-08-27T12:00:00.000Z");
  });
});
