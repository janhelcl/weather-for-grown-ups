import { describe, expect, it, vi } from "vitest";
import { ProfileDiagnosticsService } from "../src/core/profile-diagnostics.js";
import type { ProfileResult } from "../src/core/types.js";

const profile: ProfileResult = {
  model: "gfs_0p25",
  run: "2026-08-20T06:00:00.000Z",
  validTime: "2026-08-20T12:00:00.000Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  levels: [
    { pressureHpa: 900, temperatureC: 5, geopotentialHeightGpm: 1000 },
    { pressureHpa: 850, temperatureC: 2, geopotentialHeightGpm: 1500 },
    { pressureHpa: 800, temperatureC: -3, geopotentialHeightGpm: 2000 },
    { pressureHpa: 750, temperatureC: -1, geopotentialHeightGpm: 2500 },
    { pressureHpa: 700, temperatureC: -6, geopotentialHeightGpm: 3000 },
  ],
  source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false },
};

const query = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-20T06:00:00Z",
  validTime: "2026-08-20T12:00:00Z",
  pressureLevelsHpa: [900, 850, 800, 750, 700],
  diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"] as const,
  source: "nomads" as const,
};

describe("ProfileDiagnosticsService", () => {
  it("uses one minimal profile fetch and derives all requested whole-profile diagnostics", async () => {
    const getProfile = vi.fn(async () => profile);
    const result = await new ProfileDiagnosticsService({ profileGetter: { getProfile } }).getProfileDiagnostics(query);

    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(getProfile).toHaveBeenCalledWith({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      variables: ["temperature", "geopotential_height"],
      pressureLevelsHpa: query.pressureLevelsHpa,
      source: "nomads",
    });

    expect(result.sampledPressureLevelsHpa).toEqual(query.pressureLevelsHpa);
    expect(result.levels).toEqual(profile.levels);
    const freezing = result.diagnostics.find((diagnostic) => diagnostic.id === "freezing_level_crossings");
    const inversions = result.diagnostics.find((diagnostic) => diagnostic.id === "temperature_inversion_layers");
    expect(freezing?.id).toBe("freezing_level_crossings");
    if (!freezing || freezing.id !== "freezing_level_crossings") throw new Error("missing freezing diagnostic");
    expect(freezing.crossings).toHaveLength(1);
    expect(freezing.crossings[0]?.geopotentialHeightGpm).toBeCloseTo(1700, 10);
    expect(inversions?.id).toBe("temperature_inversion_layers");
    if (!inversions || inversions.id !== "temperature_inversion_layers") throw new Error("missing inversion diagnostic");
    expect(inversions.layers).toHaveLength(1);
    expect(inversions.layers[0]).toMatchObject({
      basePressureHpa: 800,
      topPressureHpa: 750,
      temperatureIncreaseC: 2,
      sampledSegments: 1,
    });
  });

  it("deduplicates repeated diagnostics and pressure levels before the profile fetch", async () => {
    const getProfile = vi.fn(async () => ({ ...profile, levels: profile.levels.slice(0, 2) }));
    const result = await new ProfileDiagnosticsService({ profileGetter: { getProfile } }).getProfileDiagnostics({
      ...query,
      pressureLevelsHpa: [900, 850, 900],
      diagnostics: ["freezing_level_crossings", "freezing_level_crossings"],
    });
    expect(getProfile).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature", "geopotential_height"],
      pressureLevelsHpa: [900, 850],
    }));
    expect(result.diagnostics.map((diagnostic) => diagnostic.id)).toEqual(["freezing_level_crossings"]);
  });

  it("propagates the S3 profile provenance", async () => {
    const getProfile = vi.fn(async () => ({
      ...profile,
      source: { provider: "NOAA AWS Open Data" as const, access: "s3_range" as const, decoder: "wgrib2" as const, cacheHit: true },
    }));
    const result = await new ProfileDiagnosticsService({ profileGetter: { getProfile } }).getProfileDiagnostics({ ...query, source: "s3" });
    expect(getProfile).toHaveBeenCalledWith(expect.objectContaining({ source: "s3" }));
    expect(result.source).toMatchObject({ provider: "NOAA AWS Open Data", access: "s3_range", cacheHit: true });
  });
});
