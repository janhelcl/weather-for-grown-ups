import { describe, expect, it, vi } from "vitest";
import { HistoricalDiagnosticsService } from "../src/core/history-diagnostics.js";
import type { HistoricalProfileResult } from "../src/schema/history-result.js";

function profile(levels: HistoricalProfileResult["levels"]): HistoricalProfileResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime: "2017-05-09T12:00:00.000Z",
    requestedPoint: { latitude: 50.08, longitude: 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: {
      variables: ["temperature", "u_wind", "v_wind", "geopotential_height"],
      pressureLevelsHpa: levels.map((level) => level.pressureHpa),
    },
    levels,
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: "archive.grb2",
      cacheHit: true,
    },
    caveat: "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
  };
}

describe("HistoricalDiagnosticsService", () => {
  it("reuses shared layer diagnostics on archived analysis profiles", async () => {
    const getHistoricalProfile = vi.fn(async () => profile([
      { pressureHpa: 850, temperatureC: 10, uWindMs: 3, vWindMs: 4, geopotentialHeightGpm: 1500 },
      { pressureHpa: 700, temperatureC: 0, uWindMs: 9, vWindMs: 8, geopotentialHeightGpm: 3000 },
    ]));
    const service = new HistoricalDiagnosticsService({ profileGetter: { getHistoricalProfile } });

    const result = await service.getLayerDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      lowerPressureHpa: 850,
      upperPressureHpa: 700,
      diagnostics: ["temperature_lapse_rate", "wind_shear", "potential_temperature_gradient"],
    });

    expect(result.model).toBe("gfs_grid4_analysis_0p5");
    expect(result.layer.depthGpm).toBe(1500);
    expect(result.diagnostics.map((item) => item.id)).toEqual([
      "temperature_lapse_rate",
      "wind_shear",
      "potential_temperature_gradient",
    ]);
    expect(getHistoricalProfile).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.arrayContaining(["temperature", "u_wind", "v_wind", "geopotential_height"]),
      pressureLevelsHpa: [850, 700],
    }));
  });

  it("reuses shared freezing-level and inversion diagnostics on archived profiles", async () => {
    const getHistoricalProfile = vi.fn(async () => profile([
      { pressureHpa: 900, temperatureC: 4, geopotentialHeightGpm: 1000 },
      { pressureHpa: 800, temperatureC: -2, geopotentialHeightGpm: 2000 },
      { pressureHpa: 700, temperatureC: 1, geopotentialHeightGpm: 3000 },
    ]));
    const service = new HistoricalDiagnosticsService({ profileGetter: { getHistoricalProfile } });

    const result = await service.getProfileDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      pressureLevelsHpa: [900, 800, 700],
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
    });

    expect(result.diagnostics[0]?.id).toBe("freezing_level_crossings");
    if (result.diagnostics[0]?.id === "freezing_level_crossings") {
      expect(result.diagnostics[0].crossings.length).toBeGreaterThan(0);
    }
    expect(result.diagnostics[1]?.id).toBe("temperature_inversion_layers");
    if (result.diagnostics[1]?.id === "temperature_inversion_layers") {
      expect(result.diagnostics[1].layers.length).toBe(1);
    }
    expect(getHistoricalProfile).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature", "geopotential_height"],
    }));
  });
});
