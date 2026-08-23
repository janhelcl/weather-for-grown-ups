import { describe, expect, it, vi } from "vitest";
import { LayerDiagnosticsService } from "../src/core/layer-diagnostics.js";
import type { ProfileResult } from "../src/core/types.js";

const lower = {
  pressureHpa: 850,
  temperatureC: 12,
  geopotentialHeightGpm: 1500,
  uWindMs: 3,
  vWindMs: 4,
};
const upper = {
  pressureHpa: 700,
  temperatureC: 0,
  geopotentialHeightGpm: 3000,
  uWindMs: -10,
  vWindMs: 0,
};
const profile: ProfileResult = {
  model: "gfs_0p25",
  run: "2026-08-20T06:00:00.000Z",
  validTime: "2026-08-20T12:00:00.000Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  levels: [lower, upper],
  source: {
    provider: "NOAA NOMADS",
    access: "nomads_grib_filter",
    decoder: "wgrib2",
    cacheHit: false,
  },
};

const query = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-20T06:00:00Z",
  validTime: "2026-08-20T12:00:00Z",
  lowerPressureHpa: 850,
  upperPressureHpa: 700,
  diagnostics: ["temperature_lapse_rate", "wind_shear", "potential_temperature_gradient"] as const,
  source: "nomads" as const,
};

describe("LayerDiagnosticsService", () => {
  it("fetches one minimal two-level profile and derives all requested diagnostics", async () => {
    const getProfile = vi.fn(async () => profile);
    const result = await new LayerDiagnosticsService({ profileGetter: { getProfile } }).getLayerDiagnostics(query);

    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(getProfile).toHaveBeenCalledWith({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-20T06:00:00Z",
      validTime: "2026-08-20T12:00:00Z",
      variables: ["temperature", "geopotential_height", "u_wind", "v_wind"],
      pressureLevelsHpa: [850, 700],
      source: "nomads",
    });

    expect(result).toMatchObject({
      model: "gfs_0p25",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: 6,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      layer: {
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        lowerGeopotentialHeightGpm: 1500,
        upperGeopotentialHeightGpm: 3000,
        depthGpm: 1500,
      },
      levels: [lower, upper],
      source: profile.source,
    });
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics[0]).toEqual({ id: "temperature_lapse_rate", values: { temperatureLapseRateCPerKm: 8 } });
    expect(result.diagnostics[1]?.values.windShearMagnitudeMs).toBeCloseTo(13.6014705, 6);
    expect(result.diagnostics[1]?.values.windShearMsPerKm).toBeCloseTo(9.067647, 6);
    expect(result.diagnostics[2]?.values.potentialTemperatureGradientKPerKm).toBeCloseTo(2.4881247, 6);
  });

  it("deduplicates repeated diagnostics before dependency planning and output", async () => {
    const getProfile = vi.fn(async () => profile);
    const result = await new LayerDiagnosticsService({ profileGetter: { getProfile } }).getLayerDiagnostics({
      ...query,
      diagnostics: ["wind_shear", "wind_shear"],
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.id)).toEqual(["wind_shear"]);
    expect(getProfile).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["u_wind", "v_wind", "geopotential_height"],
    }));
  });

  it("propagates the selected source through the shared profile core", async () => {
    const getProfile = vi.fn(async () => ({
      ...profile,
      source: { provider: "NOAA AWS Open Data" as const, access: "s3_range" as const, decoder: "wgrib2" as const, cacheHit: true },
    }));
    const result = await new LayerDiagnosticsService({ profileGetter: { getProfile } }).getLayerDiagnostics({ ...query, source: "s3" });
    expect(getProfile).toHaveBeenCalledWith(expect.objectContaining({ source: "s3" }));
    expect(result.source).toMatchObject({ provider: "NOAA AWS Open Data", access: "s3_range", cacheHit: true });
  });

  it("fails if endpoint geopotential heights are physically inverted", async () => {
    const getProfile = vi.fn(async () => ({ ...profile, levels: [lower, { ...upper, geopotentialHeightGpm: 1400 }] }));
    await expect(new LayerDiagnosticsService({ profileGetter: { getProfile } }).getLayerDiagnostics(query)).rejects.toThrow(/upper geopotential height/);
  });
});
