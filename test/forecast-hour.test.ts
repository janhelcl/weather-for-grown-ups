import { describe, expect, it } from "vitest";
import { forecastHour, parseGfsRun } from "../src/core/forecast-hour.js";

const HOUR_MS = 3_600_000;
const atForecastHour = (run: Date, hour: number) => new Date(run.getTime() + hour * HOUR_MS);

describe("parseGfsRun", () => {
  it.each(["00", "06", "12", "18"])("accepts the %sZ GFS cycle", (hour) => {
    const value = `2026-08-19T${hour}:00:00Z`;
    expect(parseGfsRun(value).toISOString()).toBe(value);
  });

  it("accepts an offset timestamp that resolves to a GFS UTC cycle", () => {
    expect(parseGfsRun("2026-08-19T08:00:00+02:00").toISOString()).toBe("2026-08-19T06:00:00.000Z");
  });

  it.each([
    "not-a-date",
    "2026-08-19T03:00:00Z",
    "2026-08-19T06:30:00Z",
    "2026-08-19T06:00:01Z",
    "2026-08-19T06:00:00.001Z",
  ])("rejects invalid run %s", (value) => {
    expect(() => parseGfsRun(value)).toThrow();
  });
});

describe("forecastHour", () => {
  const run = new Date("2026-08-19T00:00:00Z");

  it.each([0, 1, 119, 120, 123, 126, 384])("accepts available forecast hour f%s", (hour) => {
    expect(forecastHour(run, atForecastHour(run, hour))).toBe(hour);
  });

  it.each([121, 122, 124, 125])("rejects unavailable hourly step f%s after f120", (hour) => {
    expect(() => forecastHour(run, atForecastHour(run, hour))).toThrow(/every 3 hours/);
  });

  it("rejects valid times before the model run", () => {
    expect(() => forecastHour(run, atForecastHour(run, -1))).toThrow(/at or after run time/);
  });

  it("rejects fractional forecast hours", () => {
    expect(() => forecastHour(run, new Date(run.getTime() + 30 * 60_000))).toThrow(/whole forecast hour/);
  });

  it("rejects forecast hours beyond the GFS horizon", () => {
    expect(() => forecastHour(run, atForecastHour(run, 385))).toThrow(/<= 384/);
  });
});
