import { describe, expect, it } from "vitest";
import type { GefsMember } from "../src/catalog/gefs.js";
import type { GefsMemberDataRequest } from "../src/cache/gefs-s3-subset-cache.js";
import { GefsBatchPointsService } from "../src/core/gefs-batch-points.js";
import type { DecodedValue } from "../src/core/types.js";

const run = new Date("2026-08-24T00:00:00.000Z");
const validTime = "2026-08-24T06:00:00.000Z";
const members = ["c00", "p01", "p02"] as GefsMember[];
const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.2, longitude: 16.6 },
];

function decoderValue(path: string, longitude: number, latitude: number): DecodedValue[] {
  const memberOffset = path.includes("p01") ? 1 : path.includes("p02") ? 2 : 0;
  const pointOffset = latitude < 50 ? 10 : 0;
  return [{
    code: "TMP",
    pressureHpa: 850,
    value: 273.15 + memberOffset + pointOffset,
    gridPoint: latitude < 50
      ? { latitude: 49, longitude: 16.5 }
      : { latitude: 50, longitude: 14.5 },
  }];
}

describe("GefsBatchPointsService", () => {
  it("fetches one field slice per member and summarizes every point", async () => {
    const fetches: GefsMemberDataRequest[] = [];
    const decodes: Array<{ path: string; longitude: number; latitude: number }> = [];
    const service = new GefsBatchPointsService({
      source: {
        fetch: async (request) => {
          fetches.push(request);
          return { path: `/tmp/${request.member}.grib2`, cacheHit: request.member === "c00" };
        },
      },
      decoder: {
        extractPoint: async (path, longitude, latitude) => {
          decodes.push({ path, longitude, latitude });
          return decoderValue(path, longitude, latitude);
        },
      },
      memberConcurrency: 2,
    });

    const result = await service.getPoints({
      points,
      run: run.toISOString(),
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members,
      quantiles: [0.9, 0.1, 0.5],
      thresholdGte: 1,
    });

    expect(fetches).toHaveLength(3);
    expect(fetches.map((request) => request.member).sort()).toEqual([...members].sort());
    expect(fetches.every((request) => request.variableCode === "TMP" && request.pressureLevelHpa === 850)).toBe(true);
    expect(decodes).toHaveLength(6);
    expect(result.selection.members).toEqual(members);
    expect(result.selection.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(result.points).toHaveLength(2);
    expect(result.points[0]?.gridPoint).toEqual({ latitude: 50, longitude: 14.5 });
    expect(result.points[0]?.summary.mean).toBeCloseTo(1);
    expect(result.points[0]?.summary.populationStdDev).toBeCloseTo(Math.sqrt(2 / 3));
    expect(result.points[0]?.summary.threshold?.fraction).toBeCloseTo(2 / 3);
    expect(result.points[0]?.members).toBeUndefined();
    expect(result.points[1]?.gridPoint).toEqual({ latitude: 49, longitude: 16.5 });
    expect(result.points[1]?.summary.mean).toBeCloseTo(11);
    expect(result.source.memberFiles).toEqual([
      { member: "c00", cacheHit: true },
      { member: "p01", cacheHit: false },
      { member: "p02", cacheHit: false },
    ]);
    expect(result.source.allCacheHit).toBe(false);
  });

  it("optionally includes member values per point", async () => {
    const service = new GefsBatchPointsService({
      source: { fetch: async (request) => ({ path: `/tmp/${request.member}.grib2`, cacheHit: true }) },
      decoder: { extractPoint: async (path, longitude, latitude) => decoderValue(path, longitude, latitude) },
    });

    const result = await service.getPoints({
      points: [points[0]!],
      run: run.toISOString(),
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members,
      includeMembers: true,
    });

    expect(result.points[0]?.members).toEqual([
      { member: "c00", value: 0 },
      { member: "p01", value: 1 },
      { member: "p02", value: 2 },
    ]);
  });

  it("preserves non-temperature units and reports a fully cached member set", async () => {
    const service = new GefsBatchPointsService({
      source: { fetch: async (request) => ({ path: `/tmp/${request.member}.grib2`, cacheHit: true }) },
      decoder: {
        extractPoint: async (path) => [{
          code: "RH",
          pressureHpa: 850,
          value: path.includes("p01") ? 55 : path.includes("p02") ? 65 : 45,
          gridPoint: { latitude: 50, longitude: 14.5 },
        }],
      },
    });

    const result = await service.getPoints({
      points: [points[0]!],
      run: run.toISOString(),
      validTime,
      variable: "relative_humidity",
      pressureLevelHpa: 850,
      members,
    });

    expect(result.selection.unit).toBe("%");
    expect(result.points[0]?.summary.mean).toBe(55);
    expect(result.source.allCacheHit).toBe(true);
  });

  it("rejects a decoded member slice missing the selected field", async () => {
    const service = new GefsBatchPointsService({
      source: { fetch: async (request) => ({ path: `/tmp/${request.member}.grib2`, cacheHit: true }) },
      decoder: {
        extractPoint: async () => [{
          code: "HGT",
          pressureHpa: 850,
          value: 1500,
          gridPoint: { latitude: 50, longitude: 14.5 },
        }],
      },
    });

    await expect(service.getPoints({
      points: [points[0]!],
      run: run.toISOString(),
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members,
    })).rejects.toThrow("subset is missing TMP@850mb");
  });

  it("rejects inconsistent sampled grid points across members at one location", async () => {
    const service = new GefsBatchPointsService({
      source: { fetch: async (request) => ({ path: `/tmp/${request.member}.grib2`, cacheHit: false }) },
      decoder: {
        extractPoint: async (path) => [{
          code: "TMP",
          pressureHpa: 850,
          value: 280,
          gridPoint: path.includes("p01")
            ? { latitude: 49.5, longitude: 14.5 }
            : { latitude: 50, longitude: 14.5 },
        }],
      },
      memberConcurrency: 1,
    });

    await expect(service.getPoints({
      points: [points[0]!],
      run: run.toISOString(),
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members,
    })).rejects.toThrow("inconsistent grid points at batched point index 0");
  });

  it("uses query-aware latest resolution once for the whole point set", async () => {
    let resolutions = 0;
    const service = new GefsBatchPointsService({
      latestRunProvider: {
        resolveLatestRun: async (requestedValidTime, requestedMembers) => {
          resolutions += 1;
          expect(requestedValidTime.toISOString()).toBe(validTime);
          expect(requestedMembers).toEqual(members);
          return run;
        },
      },
      source: { fetch: async (request) => ({ path: `/tmp/${request.member}.grib2`, cacheHit: true }) },
      decoder: { extractPoint: async (path, longitude, latitude) => decoderValue(path, longitude, latitude) },
    });

    const result = await service.getPoints({
      points,
      run: "latest",
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members,
    });
    expect(resolutions).toBe(1);
    expect(result.run).toBe(run.toISOString());
  });
});
