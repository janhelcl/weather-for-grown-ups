import { describe, expect, it, vi } from "vitest";
import { GefsLayerDiagnosticsService } from "../src/core/gefs-layer-diagnostics.js";
import { gefsEnsembleProfileResultSchema } from "../src/schema/gefs-ensemble-profile.js";

const run = "2026-08-23T12:00:00Z";
const validTime = "2026-08-23T18:00:00Z";

function memberValues(memberIndex: number) {
  const lowerTemperature = [10, 12, 8][memberIndex]!;
  const upperTemperature = [-10, -8, -12][memberIndex]!;
  const upperU = [10, 20, 30][memberIndex]!;
  return [
    { variable: "temperature" as const, pressureLevelHpa: 850, value: lowerTemperature },
    { variable: "geopotential_height" as const, pressureLevelHpa: 850, value: 1500 },
    { variable: "u_wind" as const, pressureLevelHpa: 850, value: 0 },
    { variable: "v_wind" as const, pressureLevelHpa: 850, value: 0 },
    { variable: "temperature" as const, pressureLevelHpa: 500, value: upperTemperature },
    { variable: "geopotential_height" as const, pressureLevelHpa: 500, value: 5500 },
    { variable: "u_wind" as const, pressureLevelHpa: 500, value: upperU },
    { variable: "v_wind" as const, pressureLevelHpa: 500, value: 0 },
  ];
}

const profileResult = gefsEnsembleProfileResultSchema.parse({
  model: "gefs_0p50",
  run,
  validTime,
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    variables: ["temperature", "geopotential_height", "u_wind", "v_wind"],
    pressureLevelsHpa: [850, 500],
    members: ["c00", "p01", "p02"],
    quantiles: [0.5],
  },
  summaries: [{
    variable: "temperature",
    gfsCode: "TMP",
    pressureLevelHpa: 850,
    outputField: "temperatureC",
    unit: "degC",
    memberCount: 3,
    mean: 10,
    populationStdDev: Math.sqrt(8 / 3),
    min: 8,
    max: 12,
    quantiles: [{ quantile: 0.5, value: 10 }],
  }],
  members: ["c00", "p01", "p02"].map((member, index) => ({
    member,
    cacheHit: index > 0,
    values: memberValues(index),
  })),
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    product: "pgrb2a_0p50",
    allCacheHit: false,
  },
});

describe("GEFS layer diagnostics", () => {
  it("applies the shared layer kernel per member and summarizes outputs", async () => {
    const requests: unknown[] = [];
    const service = new GefsLayerDiagnosticsService({
      profileGetter: {
        getProfile: async (query) => {
          requests.push(query);
          return profileResult;
        },
      },
    });

    const result = await service.getLayerDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate", "wind_shear"],
      members: ["c00", "p01", "p02"],
      quantiles: [0.5],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      variables: ["temperature", "geopotential_height", "u_wind", "v_wind"],
      pressureLevelsHpa: [850, 500],
      includeMembers: true,
    });
    expect(result.members).toBeUndefined();
    expect(result.layerDepthGpm).toMatchObject({ mean: 4000, populationStdDev: 0, min: 4000, max: 4000 });

    const lapse = result.summaries.find((summary) => summary.field === "temperatureLapseRateCPerKm");
    expect(lapse?.distribution).toMatchObject({ mean: 5, populationStdDev: 0, min: 5, max: 5 });
    const shear = result.summaries.find((summary) => summary.field === "windShearMagnitudeMs");
    expect(shear?.distribution.mean).toBe(20);
    expect(shear?.distribution.populationStdDev).toBeCloseTo(Math.sqrt(200 / 3));
    expect(shear?.distribution.quantiles).toEqual([{ quantile: 0.5, value: 20 }]);
  });

  it("returns memberwise audit data only when requested", async () => {
    const service = new GefsLayerDiagnosticsService({ profileGetter: { getProfile: async () => profileResult } });
    const result = await service.getLayerDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["wind_shear"],
      members: ["c00", "p01", "p02"],
      quantiles: [0.5],
      includeMembers: true,
    });
    expect(result.members?.map((member) => member.member)).toEqual(["c00", "p01", "p02"]);
    expect(result.members?.[0]?.diagnostics[0]?.values.windShearMagnitudeMs).toBe(10);
  });

  it("rejects pressure surfaces that cannot satisfy diagnostic dependencies before profile access", async () => {
    const getProfile = vi.fn(async () => profileResult);
    const service = new GefsLayerDiagnosticsService({ profileGetter: { getProfile } });
    await expect(service.getLayerDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      lowerPressureHpa: 400,
      upperPressureHpa: 300,
      diagnostics: ["wind_shear"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("geopotential_height");
    expect(getProfile).not.toHaveBeenCalled();
  });
});
