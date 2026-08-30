import { describe, expect, it, vi } from "vitest";
import {
  GefsReforecastDiagnosticTimeSeriesService,
  GefsReforecastLayerDiagnosticsService,
  GefsReforecastProfileDiagnosticsService,
} from "../src/core/gefs-reforecast-diagnostics.js";
import {
  gefsReforecastLayerDiagnosticsQuerySchema,
  gefsReforecastProfileDiagnosticsQuerySchema,
  type GefsReforecastLayerDiagnosticsResult,
  type GefsReforecastProfileDiagnosticsResult,
} from "../src/schema/gefs-reforecast-diagnostics.js";
import { gefsReforecastProfileResultSchema } from "../src/schema/gefs-reforecast.js";

const run = "2017-03-14T00:00:00.000Z";
const validTime = "2017-03-14T12:00:00.000Z";
const point = { latitude: 50.08, longitude: 14.43 };
const gridPoint = { latitude: 50, longitude: 14.5 };
const members = ["c00", "p01", "p02"] as const;
const quantiles = [0.5];

function distribution(mean: number) {
  return {
    memberCount: 3,
    mean,
    populationStdDev: 1,
    min: mean - 1,
    max: mean + 1,
    quantiles: [{ quantile: 0.5, value: mean }],
  };
}

function layerMemberValues(index: number) {
  const lowerTemperature = [10, 12, 8][index]!;
  const upperTemperature = [-10, -8, -12][index]!;
  const upperU = [10, 20, 30][index]!;
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

function layerProfileResult() {
  return gefsReforecastProfileResultSchema.parse({
    model: "gefs_v12_reforecast",
    run,
    validTime,
    forecastHour: 12,
    requestedPoint: point,
    gridPoint,
    selection: {
      variables: ["temperature", "geopotential_height", "u_wind", "v_wind"],
      pressureLevelsHpa: [850, 500],
      members: [...members],
      quantiles,
    },
    summaries: [{
      variable: "temperature",
      gfsCode: "TMP",
      pressureLevelHpa: 850,
      outputField: "temperatureC",
      unit: "degC",
      memberCount: 3,
      mean: 10,
      populationStdDev: 1,
      min: 8,
      max: 12,
      quantiles: [{ quantile: 0.5, value: 10 }],
    }],
    members: members.map((member, index) => ({
      member,
      cacheHit: index !== 0,
      values: layerMemberValues(index),
    })),
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "gribberish",
      archiveType: "reforecast",
      dataset: "GEFSv12/reforecast",
      leadBlock: "Days:1-10",
      horizontalGridDegrees: 0.5,
      profileGridPolicy: "coherent_0p50",
      allCacheHit: false,
    },
  });
}

const profilePressureLevels = [1000, 925, 850, 700, 500];
const heights = [100, 800, 1500, 3000, 5500];
const temperatures = [
  [5, 2, -1, -10, -25],
  [-2, -1, 1, -5, -20],
  [-5, -4, -3, -2, -1],
];

function structuralProfileResult() {
  return gefsReforecastProfileResultSchema.parse({
    model: "gefs_v12_reforecast",
    run,
    validTime,
    forecastHour: 12,
    requestedPoint: point,
    gridPoint,
    selection: {
      variables: ["temperature", "geopotential_height"],
      pressureLevelsHpa: profilePressureLevels,
      members: [...members],
      quantiles,
    },
    summaries: [{
      variable: "temperature",
      gfsCode: "TMP",
      pressureLevelHpa: 1000,
      outputField: "temperatureC",
      unit: "degC",
      memberCount: 3,
      mean: -2 / 3,
      populationStdDev: 1,
      min: -5,
      max: 5,
      quantiles: [{ quantile: 0.5, value: -2 }],
    }],
    members: members.map((member, memberIndex) => ({
      member,
      cacheHit: true,
      values: profilePressureLevels.flatMap((pressureLevelHpa, levelIndex) => [
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
      ]),
    })),
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "gribberish",
      archiveType: "reforecast",
      dataset: "GEFSv12/reforecast",
      leadBlock: "Days:1-10",
      horizontalGridDegrees: 0.5,
      profileGridPolicy: "coherent_0p50",
      allCacheHit: true,
    },
  });
}

describe("GEFSv12 retrospective diagnostic schemas", () => {
  it("accepts all native layer/profile diagnostics and rejects invalid selections", () => {
    expect(gefsReforecastLayerDiagnosticsQuerySchema.parse({
      ...point,
      run,
      validTime,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: [
        "temperature_lapse_rate",
        "wind_shear",
        "potential_temperature_gradient",
      ],
      members: ["c00", "p01"],
      quantiles,
    }).diagnostics).toHaveLength(3);

    expect(gefsReforecastProfileDiagnosticsQuerySchema.parse({
      ...point,
      run,
      validTime,
      pressureLevelsHpa: profilePressureLevels,
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      members: ["c00", "p01"],
      quantiles,
    }).diagnostics).toHaveLength(2);

    expect(() => gefsReforecastLayerDiagnosticsQuerySchema.parse({
      ...point,
      run,
      validTime,
      lowerPressureHpa: 500,
      upperPressureHpa: 850,
      diagnostics: ["wind_shear"],
      members: ["c00", "p01"],
      quantiles,
    })).toThrow("lowerPressureHpa must be greater");

    expect(() => gefsReforecastProfileDiagnosticsQuerySchema.parse({
      ...point,
      run,
      validTime,
      pressureLevelsHpa: [850, 850],
      diagnostics: ["freezing_level_crossings"],
      members: ["c00", "p01"],
      quantiles,
    })).toThrow("pressure levels must not contain duplicates");

    expect(() => gefsReforecastLayerDiagnosticsQuerySchema.parse({
      ...point,
      run,
      validTime,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["wind_shear", "wind_shear"],
      members: ["c00", "p01"],
      quantiles,
    })).toThrow("diagnostic selection must not contain duplicates");

    expect(() => gefsReforecastLayerDiagnosticsQuerySchema.parse({
      ...point,
      run,
      validTime,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["wind_shear"],
      members: ["c00", "c00"],
      quantiles,
    })).toThrow("members must not contain duplicates");

    expect(() => gefsReforecastProfileDiagnosticsQuerySchema.parse({
      ...point,
      run,
      validTime,
      pressureLevelsHpa: [850, 500],
      diagnostics: ["freezing_level_crossings"],
      members: ["c00", "p01"],
      quantiles: [0.5, 0.5],
    })).toThrow("quantiles must not contain duplicates");

    expect(() => gefsReforecastProfileDiagnosticsQuerySchema.parse({
      ...point,
      run,
      validTime,
      pressureLevelsHpa: [850, 50],
      diagnostics: ["freezing_level_crossings"],
      members: ["c00", "p01"],
      quantiles,
    })).toThrow("does not publish required");

  });
});

describe("GEFSv12 retrospective layer diagnostics", () => {
  it("reuses the shared layer physics per member and preserves archive provenance", async () => {
    const getProfile = vi.fn(async () => layerProfileResult());
    const result = await new GefsReforecastLayerDiagnosticsService({
      profileGetter: { getProfile },
    }).getLayerDiagnostics({
      ...point,
      run,
      validTime,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate", "wind_shear"],
      members: [...members],
      quantiles,
      includeMembers: true,
    });

    expect(getProfile).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature", "geopotential_height", "u_wind", "v_wind"],
      pressureLevelsHpa: [850, 500],
      includeMembers: true,
    }));
    expect(result.model).toBe("gefs_v12_reforecast");
    expect(result.layerDepthGpm.mean).toBe(4000);
    expect(result.summaries.find((summary) =>
      summary.field === "temperatureLapseRateCPerKm")?.distribution.mean).toBe(5);
    expect(result.summaries.find((summary) =>
      summary.field === "windShearMagnitudeMs")?.distribution.mean).toBe(20);
    expect(result.members?.map((member) => member.member)).toEqual([...members]);
    expect(result.source).toMatchObject({
      archiveType: "reforecast",
      profileGridPolicy: "coherent_0p50",
    });
  });

  it("fails if the profile adapter omits raw member payloads", async () => {
    const profile = layerProfileResult();
    const { members: _members, ...compact } = profile;
    await expect(new GefsReforecastLayerDiagnosticsService({
      profileGetter: { getProfile: async () => compact as any },
    }).getLayerDiagnostics({
      ...point,
      run,
      validTime,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate"],
      members: ["c00", "p01"],
      quantiles,
    })).rejects.toThrow("requires includeMembers=true");
  });
});

describe("GEFSv12 retrospective profile diagnostics", () => {
  it("derives structural diagnostics per member before aggregation", async () => {
    const result = await new GefsReforecastProfileDiagnosticsService({
      profileGetter: { getProfile: async () => structuralProfileResult() },
    }).getProfileDiagnostics({
      ...point,
      run,
      validTime,
      pressureLevelsHpa: [...profilePressureLevels].reverse(),
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      members: [...members],
      quantiles,
      includeMembers: true,
    });

    expect(result.sampledPressureLevelsHpa).toEqual(profilePressureLevels);
    const freezing = result.summaries.find((summary) =>
      summary.id === "freezing_level_crossings");
    if (!freezing || freezing.id !== "freezing_level_crossings") {
      throw new Error("Missing freezing summary");
    }
    expect(freezing.membersWithAnyCrossing.count).toBe(2);
    const inversion = result.summaries.find((summary) =>
      summary.id === "temperature_inversion_layers");
    if (!inversion || inversion.id !== "temperature_inversion_layers") {
      throw new Error("Missing inversion summary");
    }
    expect(inversion.membersWithAnyLayer.count).toBe(2);
    expect(result.members).toHaveLength(3);
  });
});

function layerDiagnosticResult(
  stepValidTime: string,
  forecastHour: number,
  source: {
    leadBlock: "Days:1-10" | "Days:10-16";
    horizontalGridDegrees: 0.25 | 0.5;
    profileGridPolicy: "native_0p25" | "native_0p50" | "coherent_0p50";
    decoder?: "gribberish" | "wgrib2";
  },
): GefsReforecastLayerDiagnosticsResult {
  return {
    model: "gefs_v12_reforecast",
    run,
    validTime: stepValidTime,
    forecastHour,
    requestedPoint: point,
    gridPoint: forecastHour > 240 ? { latitude: 50, longitude: 14 } : gridPoint,
    pressureLayer: { lowerPressureHpa: 850, upperPressureHpa: 700 },
    selection: {
      diagnostics: ["temperature_lapse_rate"],
      members: ["c00", "p01"],
      quantiles,
    },
    layerDepthGpm: distribution(1400),
    summaries: [{
      id: "temperature_lapse_rate",
      field: "temperatureLapseRateCPerKm",
      unit: "degC/km",
      distribution: distribution(6),
    }],
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: source.decoder ?? "gribberish",
      archiveType: "reforecast",
      dataset: "GEFSv12/reforecast",
      leadBlock: source.leadBlock,
      horizontalGridDegrees: source.horizontalGridDegrees,
      profileGridPolicy: source.profileGridPolicy,
      allCacheHit: true,
    },
  };
}

function profileDiagnosticResult(
  stepValidTime: string,
  forecastHour: number,
): GefsReforecastProfileDiagnosticsResult {
  return {
    model: "gefs_v12_reforecast",
    run,
    validTime: stepValidTime,
    forecastHour,
    requestedPoint: point,
    gridPoint,
    sampledPressureLevelsHpa: profilePressureLevels,
    selection: {
      diagnostics: ["freezing_level_crossings"],
      members: ["c00", "p01"],
      quantiles,
    },
    summaries: [{
      id: "freezing_level_crossings",
      membersWithAnyCrossing: {
        count: 1,
        memberCount: 2,
        fraction: 0.5,
        interpretation: "raw_member_fraction_not_calibrated_probability",
      },
      crossingCount: {
        ...distribution(0.5),
        memberCount: 2,
      },
      lowestCrossing: {
        contributingMemberCount: 1,
        geopotentialHeightGpm: { ...distribution(2800), memberCount: 1 },
        pressureHpa: { ...distribution(700), memberCount: 1 },
      },
      highestCrossing: {
        contributingMemberCount: 1,
        geopotentialHeightGpm: { ...distribution(2800), memberCount: 1 },
        pressureHpa: { ...distribution(700), memberCount: 1 },
      },
    }],
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "gribberish",
      archiveType: "reforecast",
      dataset: "GEFSv12/reforecast",
      leadBlock: "Days:1-10",
      horizontalGridDegrees: 0.5,
      profileGridPolicy: "coherent_0p50",
      allCacheHit: true,
    },
  };
}

describe("GEFSv12 retrospective diagnostic ranges", () => {
  it("preserves per-step grid provenance across the day-10 cadence boundary", async () => {
    const service = new GefsReforecastDiagnosticTimeSeriesService({
      layerGetter: {
        getLayerDiagnostics: async (query) => {
          const hour =
            (new Date(query.validTime).getTime() - new Date(run).getTime())
            / 3_600_000;
          return layerDiagnosticResult(
            new Date(query.validTime).toISOString(),
            hour,
            hour > 240
              ? {
                  leadBlock: "Days:10-16",
                  horizontalGridDegrees: 0.5,
                  profileGridPolicy: "native_0p50",
                }
              : {
                  leadBlock: "Days:1-10",
                  horizontalGridDegrees: 0.25,
                  profileGridPolicy: "native_0p25",
                },
          );
        },
      },
      profileGetter: {
        getProfileDiagnostics: async () =>
          profileDiagnosticResult("2017-03-23T21:00:00.000Z", 237),
      },
      stepConcurrency: 1,
    });

    const result = await service.getDiagnosticTimeSeries({
      ...point,
      run,
      startTime: "2017-03-23T21:00:00Z",
      endTime: "2017-03-24T06:00:00Z",
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      members: ["c00", "p01"],
      quantiles,
      maxSteps: 3,
    });

    expect(result.series.map((step) => step.forecastHour)).toEqual([237, 240, 246]);
    expect(result.series.map((step) => step.source.profileGridPolicy))
      .toEqual(["native_0p25", "native_0p25", "native_0p50"]);
    expect(result.series[0]!.gridPoint).not.toEqual(result.series[2]!.gridPoint);
    expect(result.source.nativeCadence).toEqual([
      { fromForecastHour: 3, throughForecastHour: 240, stepHours: 3 },
      { fromForecastHour: 246, throughForecastHour: 384, stepHours: 6 },
    ]);
  });

  it("routes profile ranges and rejects decoder drift between steps", async () => {
    const profileGetter = {
      getProfileDiagnostics: vi.fn(async (query: any) => {
        const hour =
          (new Date(query.validTime).getTime() - new Date(run).getTime())
          / 3_600_000;
        return profileDiagnosticResult(new Date(query.validTime).toISOString(), hour);
      }),
    };
    const service = new GefsReforecastDiagnosticTimeSeriesService({
      layerGetter: {
        getLayerDiagnostics: async () =>
          layerDiagnosticResult(validTime, 12, {
            leadBlock: "Days:1-10",
            horizontalGridDegrees: 0.5,
            profileGridPolicy: "coherent_0p50",
          }),
      },
      profileGetter,
    });

    const result = await service.getDiagnosticTimeSeries({
      ...point,
      run,
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [500, 850, 1000],
        diagnostics: ["freezing_level_crossings"],
      },
      members: ["c00", "p01"],
      quantiles,
      maxSteps: 2,
    });
    expect(result.series.every((step) => step.kind === "profile")).toBe(true);
    expect(profileGetter.getProfileDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        pressureLevelsHpa: [1000, 850, 500],
        includeMembers: false,
      }),
    );

    let call = 0;
    await expect(new GefsReforecastDiagnosticTimeSeriesService({
      layerGetter: {
        getLayerDiagnostics: async (query) => {
          call += 1;
          const hour =
            (new Date(query.validTime).getTime() - new Date(run).getTime())
            / 3_600_000;
          return layerDiagnosticResult(
            new Date(query.validTime).toISOString(),
            hour,
            {
              leadBlock: "Days:1-10",
              horizontalGridDegrees: 0.25,
              profileGridPolicy: "native_0p25",
              decoder: call === 2 ? "wgrib2" : "gribberish",
            },
          );
        },
      },
      profileGetter,
      stepConcurrency: 1,
    }).getDiagnosticTimeSeries({
      ...point,
      run,
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      members: ["c00", "p01"],
      quantiles,
      maxSteps: 2,
    })).rejects.toThrow("changed decoder between steps");

    let driftCall = 0;
    await expect(new GefsReforecastDiagnosticTimeSeriesService({
      layerGetter: {
        getLayerDiagnostics: async (query) => {
          driftCall += 1;
          const hour =
            (new Date(query.validTime).getTime() - new Date(run).getTime())
            / 3_600_000;
          const result = layerDiagnosticResult(
            new Date(query.validTime).toISOString(),
            hour,
            {
              leadBlock: "Days:1-10",
              horizontalGridDegrees: 0.25,
              profileGridPolicy: "native_0p25",
            },
          );
          return driftCall === 2
            ? { ...result, forecastHour: hour + 3 }
            : result;
        },
      },
      profileGetter,
      stepConcurrency: 1,
    }).getDiagnosticTimeSeries({
      ...point,
      run,
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      members: ["c00", "p01"],
      quantiles,
      maxSteps: 2,
    })).rejects.toThrow("changed run or valid-time semantics");
  });
});
