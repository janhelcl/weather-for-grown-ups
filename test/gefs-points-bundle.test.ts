import { describe, expect, it, vi } from "vitest";
import { GefsPointsBundleService } from "../src/core/gefs-points-bundle.js";
import type { DecodedValue } from "../src/core/types.js";

const run = new Date("2026-08-24T00:00:00Z");
const validTime = new Date("2026-08-24T03:00:00Z");
const requestedPoints = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.2, longitude: 16.61 },
  { latitude: 47.81, longitude: 13.06 },
];

function decoded(member: "c00" | "p01", latitude: number, longitude: number): DecodedValue[] {
  const memberOffset = member === "p01" ? 2 : 0;
  const pointOffset = latitude < 48 ? 4 : latitude < 50 ? 2 : 0;
  const gridPoint = {
    latitude: Math.round(latitude * 2) / 2,
    longitude: Math.round(longitude * 2) / 2,
  };
  return [
    { code: "TMP", pressureHpa: 850, value: 283.15 + memberOffset + pointOffset, gridPoint },
    { code: "RH", pressureHpa: 850, value: 50 + memberOffset, gridPoint },
    { code: "TMP", heightAboveGroundM: 2, value: 288.15 + memberOffset + pointOffset, gridPoint },
    { code: "UGRD", heightAboveGroundM: 10, value: 2 + pointOffset, gridPoint },
    { code: "VGRD", heightAboveGroundM: 10, value: -2 - memberOffset, gridPoint },
  ];
}

describe("GEFS multi-point mixed bundles", () => {
  it("fetches each member selection once and reuses those files across every point", async () => {
    const fetchSelection = vi.fn(async (request: { member: string }) => ({
      path: `/tmp/${request.member}.grib2`,
      cacheHit: request.member === "c00",
    }));
    const extractPoint = vi.fn(async (path: string, longitude: number, latitude: number) =>
      decoded(path.includes("p01") ? "p01" : "c00", latitude, longitude));
    const service = new GefsPointsBundleService({
      source: { fetchSelection },
      decoder: { extractPoint },
      latestRunProvider: { resolveLatestRun: async () => run },
      memberConcurrency: 2,
      decodeConcurrency: 2,
    });

    const result = await service.getPoints({
      points: requestedPoints,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      selection: {
        variables: ["temperature", "dew_point"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m", "wind_10m"],
      },
      members: ["c00", "p01"],
      quantiles: [0.5],
      includeMembers: true,
    });

    expect(fetchSelection).toHaveBeenCalledTimes(2);
    expect(extractPoint).toHaveBeenCalledTimes(6);
    expect(result.points).toHaveLength(3);
    expect(result.source.memberFiles).toEqual([
      { member: "c00", cacheHit: true },
      { member: "p01", cacheHit: false },
    ]);
    expect(result.source.allCacheHit).toBe(false);

    expect(result.points.map((point) => point.requestedPoint)).toEqual(requestedPoints);
    expect(result.points[0]?.pressureSummaries.find((summary) => summary.variable === "temperature")?.distribution.mean).toBeCloseTo(11, 10);
    expect(result.points[1]?.pressureSummaries.find((summary) => summary.variable === "temperature")?.distribution.mean).toBeCloseTo(13, 10);
    expect(result.points[2]?.pressureSummaries.find((summary) => summary.variable === "temperature")?.distribution.mean).toBeCloseTo(15, 10);
    expect(result.points.every((point) => point.members?.length === 2)).toBe(true);
    expect(result.points.every((point) => point.fieldSummaries.some((field) => field.field === "wind_10m"))).toBe(true);
  });

  it("checks includeMembers response size before run resolution or member fetches", async () => {
    const resolveLatestRun = vi.fn(async () => run);
    const fetchSelection = vi.fn();
    const service = new GefsPointsBundleService({
      source: { fetchSelection },
      decoder: { extractPoint: vi.fn() },
      latestRunProvider: { resolveLatestRun },
    });

    await expect(service.getPoints({
      points: requestedPoints,
      run: "latest",
      validTime: validTime.toISOString(),
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m", "wind_10m"],
      },
      members: ["c00", "p01"],
      quantiles: [0.5],
      includeMembers: true,
      maxMemberSamples: 20,
    })).rejects.toThrow("exceeding maxMemberSamples=20");

    expect(resolveLatestRun).not.toHaveBeenCalled();
    expect(fetchSelection).not.toHaveBeenCalled();
  });

  it("rejects member grid disagreement independently for each point", async () => {
    let decodeCall = 0;
    const service = new GefsPointsBundleService({
      source: {
        fetchSelection: async (request) => ({ path: `/tmp/${request.member}.grib2`, cacheHit: true }),
      },
      decoder: {
        extractPoint: async (path, longitude, latitude) => {
          decodeCall += 1;
          const values = decoded(path.includes("p01") ? "p01" : "c00", latitude, longitude);
          if (decodeCall === 2) {
            return values.map((value) => ({ ...value, gridPoint: { latitude: 51, longitude: 15 } }));
          }
          return values;
        },
      },
      latestRunProvider: { resolveLatestRun: async () => run },
      decodeConcurrency: 1,
    });

    await expect(service.getPoints({
      points: [requestedPoints[0]!],
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      selection: { fields: ["temperature_2m"] },
      members: ["c00", "p01"],
    })).rejects.toThrow("inconsistent grid points");
  });
});
