import { describe, expect, it, vi } from "vitest";
import { GefsProfileDiagnosticsService } from "../src/core/gefs-profile-diagnostics.js";
import { gefsEnsembleProfileResultSchema } from "../src/schema/gefs-ensemble-profile.js";

const run = "2026-08-23T12:00:00Z";
const validTime = "2026-08-23T18:00:00Z";
const pressureLevelsHpa = [1000, 925, 850, 700, 500];
const heights = [100, 800, 1500, 3000, 5500];
const temperatures = [
  [5, 2, -1, -10, -25],
  [-2, -1, 1, -5, -20],
  [-5, -4, -3, -2, -1],
];

function memberValues(memberIndex: number) {
  return pressureLevelsHpa.flatMap((pressureLevelHpa, levelIndex) => [
    {
      variable: "temperature" as const,
      pressureLevelHpa,
      value: temperatures[memberIndex]![levelIndex]!,
    },
    {
      variable: "geopotential_height" as const,
      pressureLevelHpa,
      value: heights[levelIndex]!,
    },
  ]);
}

const profileResult = gefsEnsembleProfileResultSchema.parse({
  model: "gefs_0p50",
  run,
  validTime,
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    variables: ["temperature", "geopotential_height"],
    pressureLevelsHpa,
    members: ["c00", "p01", "p02"],
    quantiles: [0.5],
  },
  summaries: [{
    variable: "temperature",
    gfsCode: "TMP",
    pressureLevelHpa: 1000,
    outputField: "temperatureC",
    unit: "degC",
    memberCount: 3,
    mean: -2 / 3,
    populationStdDev: 0,
    min: -5,
    max: 5,
    quantiles: [{ quantile: 0.5, value: -2 }],
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

describe("GEFS profile diagnostics", () => {
  it("derives structures per member and summarizes only meaningful comparable features", async () => {
    const requests: unknown[] = [];
    const service = new GefsProfileDiagnosticsService({
      profileGetter: {
        getProfile: async (query) => {
          requests.push(query);
          return profileResult;
        },
      },
    });

    const result = await service.getProfileDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      pressureLevelsHpa,
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      members: ["c00", "p01", "p02"],
      quantiles: [0.5],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      variables: ["temperature", "geopotential_height"],
      pressureLevelsHpa,
      includeMembers: true,
    });
    expect(result.members).toBeUndefined();
    expect(result.sampledPressureLevelsHpa).toEqual(pressureLevelsHpa);

    const freezing = result.summaries.find((summary) => summary.id === "freezing_level_crossings");
    expect(freezing?.id).toBe("freezing_level_crossings");
    if (!freezing || freezing.id !== "freezing_level_crossings") throw new Error("Missing freezing summary");
    expect(freezing.membersWithAnyCrossing).toEqual({
      count: 2,
      memberCount: 3,
      fraction: 2 / 3,
      interpretation: "raw_member_fraction_not_calibrated_probability",
    });
    expect(freezing.crossingCount).toMatchObject({ mean: 1, min: 0, max: 2 });
    expect(freezing.lowestCrossing?.contributingMemberCount).toBe(2);
    expect(freezing.highestCrossing?.contributingMemberCount).toBe(2);

    const inversion = result.summaries.find((summary) => summary.id === "temperature_inversion_layers");
    expect(inversion?.id).toBe("temperature_inversion_layers");
    if (!inversion || inversion.id !== "temperature_inversion_layers") throw new Error("Missing inversion summary");
    expect(inversion.membersWithAnyLayer.count).toBe(2);
    expect(inversion.membersWithAnyLayer.fraction).toBeCloseTo(2 / 3);
    expect(inversion.layerCount).toMatchObject({ mean: 2 / 3, min: 0, max: 1 });
    expect(inversion.totalLayerDepthGpm.mean).toBeCloseTo((1400 + 5400) / 3);
    expect(inversion.deepestLayerDepthGpm?.contributingMemberCount).toBe(2);
    expect(inversion.strongestTemperatureIncreaseC?.distribution.max).toBe(4);
  });

  it("returns complete member structures only when requested", async () => {
    const service = new GefsProfileDiagnosticsService({ profileGetter: { getProfile: async () => profileResult } });
    const result = await service.getProfileDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      pressureLevelsHpa,
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      members: ["c00", "p01", "p02"],
      quantiles: [0.5],
      includeMembers: true,
    });

    expect(result.members?.map((member) => member.member)).toEqual(["c00", "p01", "p02"]);
    const p01 = result.members?.[1];
    const freezing = p01?.diagnostics.find((diagnostic) => diagnostic.id === "freezing_level_crossings");
    expect(freezing?.id === "freezing_level_crossings" ? freezing.crossings : []).toHaveLength(2);
    const inversion = p01?.diagnostics.find((diagnostic) => diagnostic.id === "temperature_inversion_layers");
    expect(inversion?.id === "temperature_inversion_layers" ? inversion.layers : []).toHaveLength(1);
  });

  it("omits conditional distributions when no member contains the structure", async () => {
    const coldProfile = gefsEnsembleProfileResultSchema.parse({
      ...profileResult,
      members: ["c00", "p01"].map((member) => ({
        member,
        cacheHit: true,
        values: pressureLevelsHpa.flatMap((pressureLevelHpa, index) => [
          { variable: "temperature" as const, pressureLevelHpa, value: -5 - index },
          { variable: "geopotential_height" as const, pressureLevelHpa, value: heights[index]! },
        ]),
      })),
      selection: { ...profileResult.selection, members: ["c00", "p01"] },
    });
    const service = new GefsProfileDiagnosticsService({ profileGetter: { getProfile: async () => coldProfile } });
    const result = await service.getProfileDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      pressureLevelsHpa,
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    });
    const freezing = result.summaries.find((summary) => summary.id === "freezing_level_crossings");
    if (!freezing || freezing.id !== "freezing_level_crossings") throw new Error("Missing freezing summary");
    expect(freezing.membersWithAnyCrossing.count).toBe(0);
    expect(freezing.lowestCrossing).toBeUndefined();
    expect(freezing.highestCrossing).toBeUndefined();
    const inversion = result.summaries.find((summary) => summary.id === "temperature_inversion_layers");
    if (!inversion || inversion.id !== "temperature_inversion_layers") throw new Error("Missing inversion summary");
    expect(inversion.membersWithAnyLayer.count).toBe(0);
    expect(inversion.deepestLayerDepthGpm).toBeUndefined();
  });

  it("rejects unsupported profile levels before profile access", async () => {
    const getProfile = vi.fn(async () => profileResult);
    const service = new GefsProfileDiagnosticsService({ profileGetter: { getProfile } });
    await expect(service.getProfileDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      pressureLevelsHpa: [850, 400, 300],
      diagnostics: ["freezing_level_crossings"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("temperature");
    expect(getProfile).not.toHaveBeenCalled();
  });
});
