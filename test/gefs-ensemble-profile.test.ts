import { describe, expect, it } from "vitest";
import { GefsEnsembleProfileService } from "../src/core/gefs-ensemble-profile.js";

const run = "2026-08-23T12:00:00Z";
const validTime = "2026-08-23T18:00:00Z";

function serviceFor(includeGridMismatch = false) {
  return new GefsEnsembleProfileService({
    concurrency: 2,
    source: {
      fetchSelection: async (request) => ({ path: request.member, cacheHit: request.member === "p01" }),
    },
    decoder: {
      extractPoint: async (path) => {
        const memberOffset = path === "c00" ? 0 : path === "p01" ? 1 : 2;
        const gridPoint = includeGridMismatch && path === "p02"
          ? { latitude: 50.5, longitude: 14.5 }
          : { latitude: 50, longitude: 14.5 };
        return [
          { code: "TMP", pressureHpa: 850, value: 273.15 + memberOffset, gridPoint },
          { code: "HGT", pressureHpa: 850, value: 1500 + 10 * memberOffset, gridPoint },
          { code: "TMP", pressureHpa: 500, value: 253.15 + 2 * memberOffset, gridPoint },
          { code: "HGT", pressureHpa: 500, value: 5600 + 20 * memberOffset, gridPoint },
        ];
      },
    },
  });
}

describe("GEFS ensemble profile service", () => {
  it("returns compact deterministic summaries over multiple variables and levels", async () => {
    const result = await serviceFor().getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["temperature", "geopotential_height"],
      pressureLevelsHpa: [500, 850],
      members: ["p02", "c00", "p01"],
      quantiles: [0.75, 0.5, 0.25],
    });

    expect(result.selection.members).toEqual(["c00", "p01", "p02"]);
    expect(result.selection.pressureLevelsHpa).toEqual([850, 500]);
    expect(result.selection.quantiles).toEqual([0.25, 0.5, 0.75]);
    expect(result.members).toBeUndefined();
    expect(result.summaries).toHaveLength(4);
    expect(result.summaries[0]).toMatchObject({
      variable: "temperature",
      pressureLevelHpa: 850,
      outputField: "temperatureC",
      unit: "degC",
      memberCount: 3,
      mean: 1,
      min: 0,
      max: 2,
    });
    expect(result.summaries[0]!.populationStdDev).toBeCloseTo(Math.sqrt(2 / 3));
    expect(result.summaries[0]!.quantiles).toEqual([
      { quantile: 0.25, value: 0.5 },
      { quantile: 0.5, value: 1 },
      { quantile: 0.75, value: 1.5 },
    ]);
    expect(result.summaries[1]).toMatchObject({
      variable: "geopotential_height",
      pressureLevelHpa: 850,
      mean: 1510,
    });
    expect(result.summaries[2]).toMatchObject({
      variable: "temperature",
      pressureLevelHpa: 500,
      mean: -18,
    });
    expect(result.source.allCacheHit).toBe(false);
  });

  it("includes canonical member profiles only when explicitly requested", async () => {
    const result = await serviceFor().getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      members: ["p02", "c00", "p01"],
      quantiles: [0.5],
      includeMembers: true,
    });

    expect(result.members?.map((sample) => sample.member)).toEqual(["c00", "p01", "p02"]);
    expect(result.members?.[0]?.values).toEqual([
      { variable: "temperature", pressureLevelHpa: 850, value: 0 },
      { variable: "temperature", pressureLevelHpa: 500, value: -20 },
    ]);
  });

  it("uses one multi-field source request per member", async () => {
    const requests: unknown[] = [];
    const service = new GefsEnsembleProfileService({
      source: {
        fetchSelection: async (request) => {
          requests.push(request);
          return { path: request.member, cacheHit: true };
        },
      },
      decoder: {
        extractPoint: async () => [
          { code: "TMP", pressureHpa: 850, value: 273.15, gridPoint: { latitude: 50, longitude: 14.5 } },
          { code: "HGT", pressureHpa: 850, value: 1500, gridPoint: { latitude: 50, longitude: 14.5 } },
        ],
      },
    });

    await service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["temperature", "geopotential_height"],
      pressureLevelsHpa: [850],
      members: ["c00", "p01"],
      quantiles: [0.5],
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ variableCodes: ["TMP", "HGT"], pressureLevelsHpa: [850] });
  });

  it("rejects unsupported Cartesian variable/level selections before source access", async () => {
    await expect(serviceFor().getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["temperature", "u_wind"],
      pressureLevelsHpa: [300],
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("temperature at 300 hPa");
  });

  it("rejects inconsistent member grid points", async () => {
    await expect(serviceFor(true).getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      members: ["c00", "p01", "p02"],
      quantiles: [0.5],
    })).rejects.toThrow("inconsistent grid points");
  });
});
