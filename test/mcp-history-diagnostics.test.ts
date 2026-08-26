import { describe, expect, it, vi } from "vitest";
import {
  handleGetGfsHistoricalLayerDiagnostics,
  handleGetGfsHistoricalProfileDiagnostics,
} from "../src/mcp-history-diagnostics-tool.js";

const source = {
  provider: "NOAA NCEI" as const,
  access: "ncei_thredds_ncss" as const,
  dataset: "archive.grb2",
  cacheHit: true,
};

describe("historical diagnostics MCP handlers", () => {
  it("returns structured historical layer diagnostics", async () => {
    const getLayerDiagnostics = vi.fn(async () => ({
      model: "gfs_grid4_analysis_0p5" as const,
      analysisTime: "2017-05-09T12:00:00.000Z",
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      layer: {
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        lowerGeopotentialHeightGpm: 1500,
        upperGeopotentialHeightGpm: 3000,
        depthGpm: 1500,
      },
      levels: [
        { pressureHpa: 850, temperatureC: 10, geopotentialHeightGpm: 1500 },
        { pressureHpa: 700, temperatureC: 0, geopotentialHeightGpm: 3000 },
      ],
      diagnostics: [{ id: "temperature_lapse_rate" as const, values: { temperatureLapseRateCPerKm: 6.6667 } }],
      source,
      caveat: "Diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const,
    }));

    const result = await handleGetGfsHistoricalLayerDiagnostics({ getLayerDiagnostics } as never, {
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      lowerPressureHpa: 850,
      upperPressureHpa: 700,
      diagnostics: ["temperature_lapse_rate"],
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ model: "gfs_grid4_analysis_0p5" });
  });

  it("returns structured historical profile diagnostics and preserves errors", async () => {
    const getProfileDiagnostics = vi.fn(async () => ({
      model: "gfs_grid4_analysis_0p5" as const,
      analysisTime: "2017-05-09T12:00:00.000Z",
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      sampledPressureLevelsHpa: [850, 700],
      levels: [
        { pressureHpa: 850, temperatureC: 2, geopotentialHeightGpm: 1500 },
        { pressureHpa: 700, temperatureC: -5, geopotentialHeightGpm: 3000 },
      ],
      diagnostics: [{ id: "freezing_level_crossings" as const, crossings: [] }],
      source,
      caveat: "Diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const,
    }));
    const ok = await handleGetGfsHistoricalProfileDiagnostics({ getProfileDiagnostics } as never, {
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      pressureLevelsHpa: [850, 700],
      diagnostics: ["freezing_level_crossings"],
    });
    expect(ok.isError).toBeUndefined();

    const failure = await handleGetGfsHistoricalProfileDiagnostics({
      getProfileDiagnostics: vi.fn(async () => { throw new Error("archive gap"); }),
    } as never, {
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      pressureLevelsHpa: [850, 700],
      diagnostics: ["freezing_level_crossings"],
    });
    expect(failure).toMatchObject({ isError: true, content: [{ text: "archive gap" }] });
  });
});
