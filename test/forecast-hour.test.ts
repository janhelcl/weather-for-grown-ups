import { describe, expect, it } from "vitest";
import { forecastHour, parseGfsRun } from "../src/core/forecast-hour.js";

describe("forecastHour", () => {
  it("computes forecast hour", () => {
    const run = parseGfsRun("2026-08-19T06:00:00Z");
    expect(forecastHour(run, new Date("2026-08-19T12:00:00Z"))).toBe(6);
  });

  it("rejects unavailable hourly steps after f120", () => {
    const run = parseGfsRun("2026-08-19T00:00:00Z");
    expect(() => forecastHour(run, new Date("2026-08-24T01:00:00Z"))).toThrow(/every 3 hours/);
  });
});
