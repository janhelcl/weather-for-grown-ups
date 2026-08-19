import { describe, expect, it } from "vitest";
import {
  GFS_MAX_FORECAST_HOUR,
  GFS_NATIVE_FORECAST_HOURS,
  nativeForecastHoursInRange,
  validTimeForForecastHour,
} from "../src/core/forecast-hour.js";

const run = new Date("2026-08-19T00:00:00Z");
const atHour = (hour: number) => new Date(run.getTime() + hour * 3_600_000);

describe("native GFS forecast cadence", () => {
  it("contains all 209 native outputs through f384", () => {
    expect(GFS_NATIVE_FORECAST_HOURS).toHaveLength(209);
    expect(GFS_NATIVE_FORECAST_HOURS[0]).toBe(0);
    expect(GFS_NATIVE_FORECAST_HOURS[120]).toBe(120);
    expect(GFS_NATIVE_FORECAST_HOURS[121]).toBe(123);
    expect(GFS_NATIVE_FORECAST_HOURS.at(-1)).toBe(GFS_MAX_FORECAST_HOUR);
  });

  it("is hourly through f120 and three-hourly afterwards", () => {
    for (let hour = 0; hour <= 120; hour += 1) {
      expect(GFS_NATIVE_FORECAST_HOURS).toContain(hour);
    }
    expect(GFS_NATIVE_FORECAST_HOURS).not.toContain(121);
    expect(GFS_NATIVE_FORECAST_HOURS).not.toContain(122);
    expect(GFS_NATIVE_FORECAST_HOURS).toContain(123);
    expect(GFS_NATIVE_FORECAST_HOURS).toContain(126);
  });
});

describe("nativeForecastHoursInRange", () => {
  it("includes both range boundaries when they are native outputs", () => {
    expect(nativeForecastHoursInRange(run, atHour(118), atHour(126))).toEqual([118, 119, 120, 123, 126]);
  });

  it("selects native outputs inside fractional-hour boundaries", () => {
    expect(
      nativeForecastHoursInRange(
        run,
        new Date(run.getTime() + 1.5 * 3_600_000),
        new Date(run.getTime() + 4.2 * 3_600_000),
      ),
    ).toEqual([2, 3, 4]);
  });

  it("intersects a range that begins before the model run", () => {
    expect(nativeForecastHoursInRange(run, atHour(-6), atHour(2))).toEqual([0, 1, 2]);
  });

  it("intersects a range that extends beyond the forecast horizon", () => {
    expect(nativeForecastHoursInRange(run, atHour(381), atHour(500))).toEqual([381, 384]);
  });

  it("rejects reversed ranges", () => {
    expect(() => nativeForecastHoursInRange(run, atHour(3), atHour(2))).toThrow(/endTime must be at or after startTime/);
  });

  it("rejects ranges with no model output", () => {
    expect(() => nativeForecastHoursInRange(run, atHour(-10), atHour(-1))).toThrow(/No native GFS/);
    expect(() => nativeForecastHoursInRange(run, atHour(385), atHour(500))).toThrow(/No native GFS/);
  });
});

describe("validTimeForForecastHour", () => {
  it("converts a forecast hour back to its UTC valid time without mutating the run", () => {
    expect(validTimeForForecastHour(run, 123).toISOString()).toBe("2026-08-24T03:00:00.000Z");
    expect(run.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });
});
