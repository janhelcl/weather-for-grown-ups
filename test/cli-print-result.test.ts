import { afterEach, describe, expect, it, vi } from "vitest";
import { printAtmosphericResult } from "../src/cli/print-result.js";

describe("printAtmosphericResult", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints catalog-style tables for a unified query envelope", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const table = vi.spyOn(console, "table").mockImplementation(() => {});

    printAtmosphericResult({
      dataset: "gfs",
      internalDatasetId: "gfs_0p25",
      role: "forecast",
      kind: "deterministic",
      geometryType: "point",
      timeType: "instant",
      result: {
        model: "gfs_0p25",
        run: "2026-09-06T00:00:00.000Z",
        validTime: "2026-09-06T12:00:00.000Z",
        forecastHour: 12,
        gridPoint: { latitude: 50, longitude: 14.5 },
        levels: [
          { pressureHpa: 850, temperatureC: 6.2, windSpeedMs: 8.1 },
          { pressureHpa: 500, temperatureC: -10.4, windSpeedMs: 18 },
        ],
        source: { provider: "NOAA AWS Open Data", access: "s3_range", cacheHit: true },
      },
    }, false);

    expect(log.mock.calls.map((call) => call[0])).toEqual([
      "Query:",
      "Result:",
      "Source:",
      "Levels:",
    ]);
    expect(table).toHaveBeenCalledTimes(4);
    expect(table.mock.calls[0]?.[0]).toEqual([{
      dataset: "gfs",
      internal: "gfs_0p25",
      role: "forecast",
      kind: "deterministic",
      geometry: "point",
      time: "instant",
    }]);
    expect(table.mock.calls[3]?.[0]).toEqual([
      { pressureHpa: 850, temperatureC: 6.2, windSpeedMs: 8.1 },
      { pressureHpa: 500, temperatureC: -10.4, windSpeedMs: 18 },
    ]);
  });

  it("still emits JSON when requested", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printAtmosphericResult({ dataset: "gfs" }, true);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ dataset: "gfs" }, null, 2));
  });
});
