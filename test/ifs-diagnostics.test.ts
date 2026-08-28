import { describe, expect, it, vi } from "vitest";
import { IfsDiagnosticsService } from "../src/core/ifs-diagnostics.js";
import type { IfsPointQueryInput, IfsProfileResult } from "../src/schema/ifs.js";
import {
  ifsLayerDiagnosticsQuerySchema,
  ifsParcelDiagnosticsQuerySchema,
  ifsProfileDiagnosticsQuerySchema,
} from "../src/schema/ifs-diagnostics.js";

const source = {
  provider: "ECMWF Open Data" as const,
  access: "indexed_http_range" as const,
  decoder: "gribberish" as const,
  product: "ifs_0p25_oper_fc" as const,
  horizontalGridDegrees: 0.25 as const,
  cacheHit: true,
};

function resultFor(query: IfsPointQueryInput): IfsProfileResult {
  const requested = new Set(query.pressureLevelsHpa ?? []);
  const allLevels = [
    { pressureHpa: 925, temperatureC: 5, geopotentialHeightGpm: 800, uWindMs: 3, vWindMs: 1 },
    { pressureHpa: 850, temperatureC: 10, geopotentialHeightGpm: 1500, uWindMs: 5, vWindMs: 0 },
    { pressureHpa: 700, temperatureC: -8, geopotentialHeightGpm: 3000, uWindMs: 8, vWindMs: 3 },
    { pressureHpa: 600, temperatureC: -4, geopotentialHeightGpm: 4200, uWindMs: 11, vWindMs: 6 },
    { pressureHpa: 500, temperatureC: -15, geopotentialHeightGpm: 5500, uWindMs: 15, vWindMs: 10 },
  ];
  return {
    model: "ifs_0p25",
    run: "2026-08-27T12:00:00.000Z",
    validTime: String(query.validTime).replace("Z", ".000Z"),
    forecastHour: 6,
    requestedPoint: { latitude: Number(query.latitude), longitude: Number(query.longitude) },
    gridPoint: { latitude: 50, longitude: 14.5 },
    levels: allLevels.filter((level) => requested.has(level.pressureHpa)),
    source,
  };
}

describe("IFS deterministic diagnostics", () => {
  it("uses shared layer physics with only the required IFS pressure variables", async () => {
    const getProfile = vi.fn(async (query: IfsPointQueryInput) => resultFor(query));
    const service = new IfsDiagnosticsService({ profileGetter: { getProfile } });

    const result = await service.getLayerDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T18:00:00Z",
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate", "wind_shear", "potential_temperature_gradient"],
    });

    expect(getProfile).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature", "geopotential_height", "u_wind", "v_wind"],
      pressureLevelsHpa: [850, 500],
    }));
    expect(result.model).toBe("ifs_0p25");
    expect(result.layer.depthGpm).toBe(4000);
    expect(result.diagnostics.find((value) => value.id === "temperature_lapse_rate")?.values.temperatureLapseRateCPerKm)
      .toBeCloseTo(6.25);
    expect(result.diagnostics.find((value) => value.id === "wind_shear")?.values.windShearMagnitudeMs)
      .toBeCloseTo(Math.hypot(10, 10));
    expect(result.diagnostics.find((value) => value.id === "potential_temperature_gradient")?.values.potentialTemperatureGradientKPerKm)
      .toBeTypeOf("number");
    expect(result.source).toEqual(source);
  });

  it("derives freezing crossings and inversion structure from the same normalized IFS profile", async () => {
    const getProfile = vi.fn(async (query: IfsPointQueryInput) => resultFor(query));
    const service = new IfsDiagnosticsService({ profileGetter: { getProfile } });

    const result = await service.getProfileDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T18:00:00Z",
      pressureLevelsHpa: [925, 850, 700, 600, 500],
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
    });

    expect(getProfile).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature", "geopotential_height"],
      pressureLevelsHpa: [925, 850, 700, 600, 500],
    }));
    const freezing = result.diagnostics.find((value) => value.id === "freezing_level_crossings");
    const inversions = result.diagnostics.find((value) => value.id === "temperature_inversion_layers");
    expect(freezing && "crossings" in freezing ? freezing.crossings.length : 0).toBeGreaterThan(0);
    expect(inversions && "layers" in inversions ? inversions.layers.length : 0).toBeGreaterThan(0);
    expect(result.sampledPressureLevelsHpa).toEqual([925, 850, 700, 600, 500]);
  });

  it("reuses the shared parcel engine with normalized IFS surface and pressure inputs", async () => {
    const pressureLevelsHpa = [925, 850, 700, 600, 500, 400, 300, 250];
    const profile: IfsProfileResult = {
      model: "ifs_0p25",
      run: "2026-08-27T12:00:00.000Z",
      validTime: "2026-08-27T18:00:00.000Z",
      forecastHour: 6,
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      levels: [
        { pressureHpa: 925, geopotentialHeightGpm: 800, temperatureC: 24, specificHumidityKgKg: 0.014 },
        { pressureHpa: 850, geopotentialHeightGpm: 1500, temperatureC: 14, specificHumidityKgKg: 0.009 },
        { pressureHpa: 700, geopotentialHeightGpm: 3000, temperatureC: 0, specificHumidityKgKg: 0.004 },
        { pressureHpa: 600, geopotentialHeightGpm: 4200, temperatureC: -10, specificHumidityKgKg: 0.002 },
        { pressureHpa: 500, geopotentialHeightGpm: 5600, temperatureC: -22, specificHumidityKgKg: 0.001 },
        { pressureHpa: 400, geopotentialHeightGpm: 7200, temperatureC: -32, specificHumidityKgKg: 0.0006 },
        { pressureHpa: 300, geopotentialHeightGpm: 9200, temperatureC: -38, specificHumidityKgKg: 0.0003 },
        { pressureHpa: 250, geopotentialHeightGpm: 10400, temperatureC: -25, specificHumidityKgKg: 0.0002 },
      ],
      fields: [
        { id: "surface_pressure", level: { type: "surface" }, temporal: { type: "instantaneous" }, values: { pressurePa: 100000 } },
        { id: "surface_geopotential_height", level: { type: "surface" }, temporal: { type: "instantaneous" }, values: { geopotentialHeightGpm: 100 } },
        { id: "temperature_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { temperatureC: 30 } },
        { id: "specific_humidity_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { specificHumidityKgKg: 0.018 } },
      ],
      source,
    };
    const getProfile = vi.fn(async () => profile);
    const service = new IfsDiagnosticsService({ profileGetter: { getProfile } });

    const result = await service.getParcelDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T18:00:00Z",
      pressureLevelsHpa,
      parcel: "surface_2m",
    });

    expect(getProfile).toHaveBeenCalledWith({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T18:00:00Z",
      variables: ["temperature", "specific_humidity", "geopotential_height"],
      pressureLevelsHpa,
      fields: ["surface_pressure", "surface_geopotential_height", "temperature_2m", "specific_humidity_2m"],
    });
    expect(result.parcel.startingState).toMatchObject({
      definition: "surface_2m",
      source: "surface_2m",
      pressureHpa: 1000,
      geopotentialHeightGpm: 100,
    });
    expect(Number.isFinite(result.parcel.capeJkg)).toBe(true);
    expect(Number.isFinite(result.parcel.cinJkg)).toBe(true);
    expect(result.sampledPressureLevelsHpa).toEqual(pressureLevelsHpa);
    expect(result.source).toEqual(source);
  });

  it("validates native IFS pressure levels, ordering, and duplicate selections", () => {
    expect(() => ifsLayerDiagnosticsQuerySchema.parse({
      latitude: 50,
      longitude: 14,
      run: "latest",
      validTime: "2026-08-27T18:00:00Z",
      lowerPressureHpa: 500,
      upperPressureHpa: 850,
      diagnostics: ["wind_shear"],
    })).toThrow("lowerPressureHpa must be greater");

    expect(() => ifsLayerDiagnosticsQuerySchema.parse({
      latitude: 50,
      longitude: 14,
      run: "latest",
      validTime: "2026-08-27T18:00:00Z",
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["wind_shear", "wind_shear"],
    })).toThrow("must not contain duplicates");

    expect(() => ifsProfileDiagnosticsQuerySchema.parse({
      latitude: 50,
      longitude: 14,
      run: "latest",
      validTime: "2026-08-27T18:00:00Z",
      pressureLevelsHpa: [850, 975],
      diagnostics: ["freezing_level_crossings"],
    })).toThrow("not published by the ECMWF IFS");

    expect(() => ifsProfileDiagnosticsQuerySchema.parse({
      latitude: 50,
      longitude: 14,
      run: "latest",
      validTime: "2026-08-27T18:00:00Z",
      pressureLevelsHpa: [850, 850],
      diagnostics: ["freezing_level_crossings"],
    })).toThrow("must not contain duplicates");

    expect(() => ifsParcelDiagnosticsQuerySchema.parse({
      latitude: 50,
      longitude: 14,
      run: "latest",
      validTime: "2026-08-27T18:00:00Z",
      pressureLevelsHpa: [925, 925],
      parcel: "surface_2m",
    })).toThrow("must not contain duplicates");
  });
});
