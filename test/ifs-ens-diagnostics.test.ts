import { describe, expect, it, vi } from "vitest";
import { IfsEnsDiagnosticsService } from "../src/core/ifs-ens-diagnostics.js";
import type { IfsProfileSample } from "../src/core/ifs-profile.js";
import type { IfsEnsMember } from "../src/catalog/ifs-ens.js";
import type { IfsPointQueryInput } from "../src/schema/ifs.js";
import type { NonIsobaricFieldResult, ProfileLevel } from "../src/core/types.js";

const run = new Date("2026-08-27T12:00:00Z");
const f300 = new Date(run.getTime() + 300 * 3_600_000);
const gridPoint = { latitude: 50, longitude: 14.5 };

function sample(
  member: IfsEnsMember,
  input: IfsPointQueryInput,
  levels: ProfileLevel[],
  fields?: NonIsobaricFieldResult[],
): IfsProfileSample {
  const validTime = new Date(String(input.validTime));
  return {
    model: "ifs_0p25",
    run: String(input.run),
    validTime: validTime.toISOString(),
    forecastHour: (validTime.getTime() - run.getTime()) / 3_600_000,
    requestedPoint: {
      latitude: Number(input.latitude),
      longitude: Number(input.longitude),
    },
    gridPoint,
    levels,
    ...(fields === undefined ? {} : { fields }),
    source: {
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      product: "ifs_0p25_enfo_ef",
      horizontalGridDegrees: 0.25,
      cacheHit: member === "p02",
    },
  };
}

describe("IFS ENS member-first diagnostics", () => {
  it("derives layer diagnostics independently in each perturbation through the ENS-only f300 horizon", async () => {
    const getProfile = vi.fn(async (member: IfsEnsMember, input: IfsPointQueryInput) => {
      const p01 = member === "p01";
      return sample(member, input, [
        { pressureHpa: 850, temperatureC: p01 ? 10 : 12, geopotentialHeightGpm: 1_500 },
        { pressureHpa: 500, temperatureC: p01 ? -10 : -12, geopotentialHeightGpm: 5_500 },
      ]);
    });
    const service = new IfsEnsDiagnosticsService({
      profileGetter: { getProfile },
      concurrency: 2,
    });

    const result = await service.getLayerDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      validTime: f300.toISOString(),
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate"],
      members: ["p01", "p02"],
      quantiles: [0.5],
      includeMembers: true,
    });

    expect(result.forecastHour).toBe(300);
    expect(result.layerDepthGpm.mean).toBe(4_000);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]).toMatchObject({
      id: "temperature_lapse_rate",
      field: "temperatureLapseRateCPerKm",
      distribution: {
        memberCount: 2,
        mean: 5.5,
        quantiles: [{ quantile: 0.5, value: 5.5 }],
      },
    });
    expect(result.members?.map((member) => member.member)).toEqual(["p01", "p02"]);
    expect(result.source.allCacheHit).toBe(false);
    expect(getProfile).toHaveBeenCalledTimes(2);
  });

  it("summarizes structural profile events instead of averaging profiles first", async () => {
    const getProfile = vi.fn(async (member: IfsEnsMember, input: IfsPointQueryInput) => {
      const temperatures = member === "p01"
        ? [5, 1, -3, -10]
        : [6, 3, 1, -5];
      return sample(member, input, [925, 850, 700, 500].map((pressureHpa, index) => ({
        pressureHpa,
        temperatureC: temperatures[index]!,
        geopotentialHeightGpm: [800, 1_500, 3_000, 5_500][index]!,
      })));
    });
    const service = new IfsEnsDiagnosticsService({ profileGetter: { getProfile } });

    const result = await service.getProfileDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      validTime: new Date(run.getTime() + 6 * 3_600_000).toISOString(),
      pressureLevelsHpa: [925, 850, 700, 500],
      diagnostics: ["freezing_level_crossings"],
      members: ["p01", "p02"],
      quantiles: [0.5],
      includeMembers: true,
    });

    const summary = result.summaries[0];
    expect(summary?.id).toBe("freezing_level_crossings");
    if (summary?.id !== "freezing_level_crossings") throw new Error("unexpected summary");
    expect(summary.membersWithAnyCrossing).toEqual({
      count: 2,
      memberCount: 2,
      fraction: 1,
      interpretation: "raw_member_fraction_not_calibrated_probability",
    });
    expect(summary.crossingCount.mean).toBe(1);
    expect(summary.lowestCrossing?.contributingMemberCount).toBe(2);
    expect(result.members?.every((member) => member.diagnostics[0]?.id === "freezing_level_crossings")).toBe(true);
  });

  it("computes parcel physics inside each perturbation and returns compact ensemble summaries", async () => {
    const getProfile = vi.fn(async (member: IfsEnsMember, input: IfsPointQueryInput) => {
      const warmer = member === "p02" ? 1 : 0;
      const levels: ProfileLevel[] = [
        { pressureHpa: 925, temperatureC: 15 + warmer, specificHumidityKgKg: 0.0075, geopotentialHeightGpm: 800 },
        { pressureHpa: 850, temperatureC: 10 + warmer, specificHumidityKgKg: 0.006, geopotentialHeightGpm: 1_500 },
        { pressureHpa: 700, temperatureC: 1 + warmer, specificHumidityKgKg: 0.004, geopotentialHeightGpm: 3_000 },
        { pressureHpa: 500, temperatureC: -14 + warmer, specificHumidityKgKg: 0.002, geopotentialHeightGpm: 5_500 },
      ];
      const fields: NonIsobaricFieldResult[] = [
        {
          id: "surface_pressure",
          level: { type: "surface" },
          temporal: { type: "instantaneous" },
          values: { pressurePa: 100_000 },
        },
        {
          id: "surface_geopotential_height",
          level: { type: "surface" },
          temporal: { type: "instantaneous" },
          values: { geopotentialHeightGpm: 100 },
        },
        {
          id: "temperature_2m",
          level: { type: "height_above_ground_m", heightM: 2 },
          temporal: { type: "instantaneous" },
          values: { temperatureC: 20 + warmer },
        },
        {
          id: "specific_humidity_2m",
          level: { type: "height_above_ground_m", heightM: 2 },
          temporal: { type: "instantaneous" },
          values: { specificHumidityKgKg: 0.009 },
        },
      ];
      return sample(member, input, levels, fields);
    });
    const service = new IfsEnsDiagnosticsService({ profileGetter: { getProfile } });

    const result = await service.getParcelDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      validTime: new Date(run.getTime() + 6 * 3_600_000).toISOString(),
      pressureLevelsHpa: [925, 850, 700, 500],
      parcel: "surface_2m",
      members: ["p01", "p02"],
      quantiles: [0.1, 0.5, 0.9],
      includeMembers: true,
    });

    expect(result.methodology).toEqual({
      pressureMoisture: "ifs_specific_humidity_direct_per_member",
      surfaceMoisture: "2m_temperature_dew_point_surface_pressure_to_specific_humidity_per_member",
      surfaceOrography: "same_cycle_f000_surface_geopotential_height",
    });
    expect(result.summary.capeJkg.memberCount).toBe(2);
    expect(Number.isFinite(result.summary.capeJkg.mean)).toBe(true);
    expect(Number.isFinite(result.summary.cinJkg.mean)).toBe(true);
    expect(result.summary.membersWithPositiveCape.memberCount).toBe(2);
    expect(result.members).toHaveLength(2);
    expect(result.members?.every((member) => Number.isFinite(member.parcel.capeJkg))).toBe(true);
  });

  it("rejects perturbations that resolve to different grid cells", async () => {
    const getProfile = vi.fn(async (member: IfsEnsMember, input: IfsPointQueryInput) => {
      const result = sample(member, input, [
        { pressureHpa: 850, temperatureC: 10, geopotentialHeightGpm: 1_500 },
        { pressureHpa: 500, temperatureC: -10, geopotentialHeightGpm: 5_500 },
      ]);
      return member === "p02"
        ? { ...result, gridPoint: { latitude: 50.25, longitude: 14.5 } }
        : result;
    });
    const service = new IfsEnsDiagnosticsService({ profileGetter: { getProfile } });

    await expect(service.getLayerDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      validTime: new Date(run.getTime() + 6 * 3_600_000).toISOString(),
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate"],
      members: ["p01", "p02"],
    })).rejects.toThrow("inconsistent grid points");
  });
});
