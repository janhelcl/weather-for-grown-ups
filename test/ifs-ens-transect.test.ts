import { describe, expect, it, vi } from "vitest";
import { IfsEnsTransectService } from "../src/core/ifs-ens-transect.js";
import type { IfsEnsPointsResult } from "../src/schema/ifs-ens-points.js";

const run = "2026-08-27T12:00:00.000Z";
const validTime = "2026-08-27T18:00:00.000Z";

function distribution(mean: number) {
  return {
    memberCount: 2,
    mean,
    populationStdDev: 1,
    min: mean - 1,
    max: mean + 1,
    quantiles: [{ quantile: 0.5, value: mean }],
  };
}

function batch(points: Array<{ latitude: number; longitude: number }>, includeMembers = false): IfsEnsPointsResult {
  return {
    model: "ifs_ens_0p25",
    run,
    validTime,
    forecastHour: 6,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: [],
      members: ["p01", "p02"],
      quantiles: [0.5],
    },
    includeMembers,
    points: points.map((point, index) => ({
      requestedPoint: point,
      gridPoint: {
        latitude: Math.round(point.latitude * 4) / 4,
        longitude: Math.round(point.longitude * 4) / 4,
      },
      pressureSummaries: [{
        variable: "temperature",
        pressureLevelHpa: 850,
        outputs: [{
          aggregation: "numeric_distribution",
          field: "temperatureC",
          unit: "degC",
          distribution: distribution(10 + index),
        }],
      }],
      fieldSummaries: [],
      ...(includeMembers
        ? {
            members: [
              {
                member: "p01",
                cacheHit: true,
                pressureValues: [{
                  variable: "temperature",
                  pressureLevelHpa: 850,
                  values: { temperatureC: 9 + index },
                }],
                fields: [],
              },
              {
                member: "p02",
                cacheHit: true,
                pressureValues: [{
                  variable: "temperature",
                  pressureLevelHpa: 850,
                  values: { temperatureC: 11 + index },
                }],
                fields: [],
              },
            ],
          }
        : {}),
      allCacheHit: true,
    })),
    source: {
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      product: "ifs_0p25_enfo_ef",
      horizontalGridDegrees: 0.25,
      allCacheHit: true,
      memberSemantics: "50_perturbed_members_control_is_oper_fc",
    },
  };
}

describe("IFS ENS transect", () => {
  it("samples one member-first multi-point bundle along a great-circle path", async () => {
    const getPoints = vi.fn(async (query: { points: Array<{ latitude: number; longitude: number }> }) =>
      batch(query.points));
    const service = new IfsEnsTransectService({ pointsGetter: { getPoints } });

    const result = await service.getTransect({
      start: { latitude: 49.8, longitude: 14.0 },
      end: { latitude: 50.3, longitude: 15.0 },
      run,
      validTime,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      members: ["p01", "p02"],
      quantiles: [0.5],
      samples: 3,
    });

    expect(getPoints).toHaveBeenCalledOnce();
    expect(getPoints.mock.calls[0]?.[0]).toMatchObject({
      run,
      validTime,
      members: ["p01", "p02"],
      samples: undefined,
    });
    expect(getPoints.mock.calls[0]?.[0].points).toHaveLength(3);
    expect(result.samples).toHaveLength(3);
    expect(result.samples.map((sample) => sample.fraction)).toEqual([0, 0.5, 1]);
    expect(result.samples[0]?.distanceKm).toBe(0);
    expect(result.samples[2]?.distanceKm).toBeCloseTo(result.totalDistanceKm);
    expect(result.totalDistanceKm).toBeGreaterThan(0);
    expect(result.samples.every((sample) => sample.pressureSummaries.length === 1)).toBe(true);
  });

  it("propagates raw member payload controls to the multi-point primitive", async () => {
    const getPoints = vi.fn(async (query: {
      points: Array<{ latitude: number; longitude: number }>;
      includeMembers?: boolean;
      maxMemberSamples?: number;
    }) => batch(query.points, query.includeMembers === true));
    const service = new IfsEnsTransectService({ pointsGetter: { getPoints } });

    const result = await service.getTransect({
      start: { latitude: 49.8, longitude: 14.0 },
      end: { latitude: 50.3, longitude: 15.0 },
      run,
      validTime,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      members: ["p01", "p02"],
      quantiles: [0.5],
      includeMembers: true,
      maxMemberSamples: 100,
      samples: 3,
    });

    expect(getPoints).toHaveBeenCalledWith(expect.objectContaining({
      includeMembers: true,
      maxMemberSamples: 100,
    }));
    expect(result.includeMembers).toBe(true);
    expect(result.samples.every((sample) => sample.members?.length === 2)).toBe(true);
  });

  it("rejects changed point order from the multi-point primitive", async () => {
    const service = new IfsEnsTransectService({
      pointsGetter: {
        getPoints: async (query) => {
          const result = batch(query.points);
          return {
            ...result,
            points: [result.points[1]!, result.points[0]!, ...result.points.slice(2)],
          };
        },
      },
    });

    await expect(service.getTransect({
      start: { latitude: 49.8, longitude: 14.0 },
      end: { latitude: 50.3, longitude: 15.0 },
      run,
      validTime,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      members: ["p01", "p02"],
      samples: 3,
    })).rejects.toThrow("changed requested point order");
  });
});
