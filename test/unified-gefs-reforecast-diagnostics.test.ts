import { describe, expect, it, vi } from "vitest";
import { UnifiedAtmosphereDiagnosticService } from "../src/core/unified-atmosphere-api.js";
import { diagnoseAtmosphereSchema } from "../src/schema/unified-api.js";

const base = {
  dataset: "gefs" as const,
  geometry: { type: "point" as const, latitude: 50.08, longitude: 14.43 },
  forecast: {
    kind: "reforecast" as const,
    run: "2017-03-14T00:00:00Z",
  },
  ensemble: {
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
};

describe("unified GEFSv12 retrospective diagnostic validation", () => {
  it("accepts layer/profile diagnostics but keeps parcel diagnostics explicit unsupported", () => {
    expect(diagnoseAtmosphereSchema.parse({
      ...base,
      time: { at: "2017-03-14T12:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate", "wind_shear"],
      },
    }).diagnostic.kind).toBe("layer");

    expect(diagnoseAtmosphereSchema.parse({
      ...base,
      time: { at: "2017-03-14T12:00:00Z" },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
        diagnostics: ["freezing_level_crossings"],
      },
    }).diagnostic.kind).toBe("profile");

    expect(() => diagnoseAtmosphereSchema.parse({
      ...base,
      time: { at: "2017-03-14T12:00:00Z" },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [850, 700, 500],
        parcel: "surface_2m",
      },
    })).toThrow("lacks the required moisture/surface inputs");
  });
});

describe("unified GEFSv12 retrospective diagnostic routing", () => {
  it("routes instant layer diagnostics to the retrospective member-first service", async () => {
    const layer = {
      getLayerDiagnostics: vi.fn(async () => ({ route: "reforecast-layer" })),
    };
    const profile = { getProfileDiagnostics: vi.fn() };
    const result = await new UnifiedAtmosphereDiagnosticService({
      gefsReforecastLayer: layer as any,
      gefsReforecastProfile: profile as any,
    }).diagnose({
      ...base,
      time: { at: "2017-03-14T12:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate", "wind_shear"],
      },
      ensemble: {
        ...base.ensemble,
        includeMembers: true,
      },
    });

    expect(result.internalDatasetId).toBe("gefs_v12_reforecast");
    expect(result.result).toEqual({ route: "reforecast-layer" });
    expect(layer.getLayerDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      run: "2017-03-14T00:00:00Z",
      validTime: "2017-03-14T12:00:00Z",
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate", "wind_shear"],
      members: ["c00", "p01"],
      quantiles: [0.5],
      includeMembers: true,
    }));
    expect(profile.getProfileDiagnostics).not.toHaveBeenCalled();
  });

  it("routes instant profile diagnostics to the retrospective structural service", async () => {
    const layer = { getLayerDiagnostics: vi.fn() };
    const profile = {
      getProfileDiagnostics: vi.fn(async () => ({ route: "reforecast-profile" })),
    };
    const result = await new UnifiedAtmosphereDiagnosticService({
      gefsReforecastLayer: layer as any,
      gefsReforecastProfile: profile as any,
    }).diagnose({
      ...base,
      time: { at: "2017-03-14T12:00:00Z" },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
        diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      },
    });

    expect(result.result).toEqual({ route: "reforecast-profile" });
    expect(profile.getProfileDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      pressureLevelsHpa: [1000, 925, 850, 700, 500],
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
    }));
    expect(layer.getLayerDiagnostics).not.toHaveBeenCalled();
  });

  it("routes retrospective diagnostic ranges without falling through to operational GEFS", async () => {
    const range = {
      getDiagnosticTimeSeries: vi.fn(async () => ({ route: "reforecast-diagnostic-range" })),
    };
    const operational = { getDiagnosticTimeSeries: vi.fn() };
    const result = await new UnifiedAtmosphereDiagnosticService({
      gefsReforecastTimeSeries: range as any,
      timeSeries: operational as any,
    }).diagnose({
      ...base,
      time: {
        from: "2017-03-23T21:00:00Z",
        to: "2017-03-24T06:00:00Z",
        maxSteps: 3,
      },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
    });

    expect(result.timeType).toBe("range");
    expect(result.result).toEqual({ route: "reforecast-diagnostic-range" });
    expect(range.getDiagnosticTimeSeries).toHaveBeenCalledWith(expect.objectContaining({
      run: "2017-03-14T00:00:00Z",
      startTime: "2017-03-23T21:00:00Z",
      endTime: "2017-03-24T06:00:00Z",
      maxSteps: 3,
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      members: ["c00", "p01"],
      quantiles: [0.5],
    }));
    expect(operational.getDiagnosticTimeSeries).not.toHaveBeenCalled();
  });
});
