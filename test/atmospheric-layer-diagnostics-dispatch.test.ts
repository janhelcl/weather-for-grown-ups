import { describe, expect, it, vi } from "vitest";
import { AtmosphericLayerDiagnosticsService } from "../src/core/atmospheric-layer-diagnostics-service.js";
import type { IfsLayerDiagnosticsResult } from "../src/schema/ifs-diagnostics.js";

const ifsResult: IfsLayerDiagnosticsResult = {
  model: "ifs_0p25",
  run: "2026-08-27T12:00:00Z",
  validTime: "2026-08-27T18:00:00Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  layer: {
    lowerPressureHpa: 850,
    upperPressureHpa: 500,
    lowerGeopotentialHeightGpm: 1500,
    upperGeopotentialHeightGpm: 5500,
    depthGpm: 4000,
  },
  levels: [
    { pressureHpa: 850, temperatureC: 10, geopotentialHeightGpm: 1500, uWindMs: 5, vWindMs: 0 },
    { pressureHpa: 500, temperatureC: -15, geopotentialHeightGpm: 5500, uWindMs: 15, vWindMs: 10 },
  ],
  diagnostics: [{
    id: "wind_shear",
    values: {
      uWindShearMs: 10,
      vWindShearMs: 10,
      windShearMagnitudeMs: Math.hypot(10, 10),
      windShearMsPerKm: Math.hypot(10, 10) / 4,
    },
  }],
  source: {
    provider: "ECMWF Open Data",
    access: "indexed_http_range",
    decoder: "gribberish",
    product: "ifs_0p25_oper_fc",
    horizontalGridDegrees: 0.25,
    cacheHit: true,
  },
};

describe("atmospheric layer diagnostics dispatch", () => {
  it("routes IFS to its deterministic diagnostic implementation", async () => {
    const getLayerDiagnostics = vi.fn(async () => ifsResult);
    const service = new AtmosphericLayerDiagnosticsService({
      ifs: { getLayerDiagnostics },
    });

    const result = await service.getLayerDiagnostics({
      model: "ifs_0p25",
      query: {
        latitude: 50.08,
        longitude: 14.43,
        run: ifsResult.run,
        validTime: ifsResult.validTime,
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
    });

    expect(result.model).toBe("ifs_0p25");
    expect(getLayerDiagnostics).toHaveBeenCalledOnce();
  });
});
