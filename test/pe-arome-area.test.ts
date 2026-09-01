import { describe, expect, it, vi } from "vitest";
import { PeAromeForecastService } from "../src/core/pe-arome.js";

describe("PE-AROME area ensemble aggregation", () => {
  it("aggregates member spatial statistics and honors area limits", async () => {
    const calls: Array<{ member: string; request: any }> = [];
    const service = new PeAromeForecastService({
      memberServiceFactory: (member) => ({
        query: vi.fn(async (request: any) => {
          calls.push({ member, request });
          const offset = member === "c00" ? 0 : 2;
          return {
            model: "arome_0p01",
            run: "2026-09-01T09:00:00.000Z",
            validTime: "2026-09-01T12:00:00.000Z",
            forecastHour: 3,
            bbox: {
              westLongitude: 14,
              eastLongitude: 14.5,
              southLatitude: 49.8,
              northLatitude: 50.2,
            },
            field: "temperature_2m",
            statistics: {
              definedGridPoints: 10,
              mean: 5 + offset,
              min: 3 + offset,
              max: 7 + offset,
            },
            distribution: {
              percentiles: [{ percentile: 50, value: 5 + offset }],
              thresholdFractions: [{ operator: ">=", threshold: 6, fraction: member === "c00" ? 0.4 : 0.6 }],
              extrema: {
                min: { value: 3 + offset, latitude: 50, longitude: 14.1 },
                max: { value: 7 + offset, latitude: 50.1, longitude: 14.2 },
              },
            },
            source: { cacheHit: member === "c00" },
          };
        }),
      }),
    });

    const result = await service.query({
      dataset: "pe-arome",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49.8,
        northLatitude: 50.2,
      },
      time: { at: "2026-09-01T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      forecast: { run: "latest" },
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.5],
        includeMembers: true,
      },
      aggregate: {
        percentiles: [50],
        thresholds: [{ operator: ">=", value: 6 }],
        includeExtremaLocations: true,
      },
      limits: {
        maxGridPoints: 1_000,
        maxMemberGridPoints: 100,
      },
    } as any) as any;

    expect(result.statistics.mean).toMatchObject({
      memberCount: 2,
      mean: 6,
      min: 5,
      max: 7,
    });
    expect(result.spatialPercentiles[0].distribution.mean).toBe(6);
    expect(result.spatialThresholdFractions[0].distribution.mean).toBe(0.5);
    expect(result.memberExtrema).toHaveLength(2);
    expect(result.members).toHaveLength(2);
    expect(result.source.allCacheHit).toBe(false);

    expect(calls[0].request).toMatchObject({
      dataset: "arome",
      limits: {
        maxGridPoints: 6_250,
        maxMemberGridPoints: 100,
      },
    });
    expect(calls[1].request.forecast.run).toBe("2026-09-01T09:00:00.000Z");
  });

  it("rejects area selections that exceed member-grid safety limits", async () => {
    const service = new PeAromeForecastService({
      memberServiceFactory: () => ({
        query: vi.fn(async () => ({
          model: "arome_0p01",
          run: "2026-09-01T09:00:00.000Z",
          validTime: "2026-09-01T12:00:00.000Z",
          forecastHour: 3,
          bbox: {
            westLongitude: 14,
            eastLongitude: 14.5,
            southLatitude: 49.8,
            northLatitude: 50.2,
          },
          field: "temperature_2m",
          statistics: {
            definedGridPoints: 60,
            mean: 5,
            min: 3,
            max: 7,
          },
          source: { cacheHit: true },
        })),
      }),
    });

    await expect(service.query({
      dataset: "pe-arome",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49.8,
        northLatitude: 50.2,
      },
      time: { at: "2026-09-01T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      ensemble: { members: ["c00", "p01"] },
      limits: { maxMemberGridPoints: 100 },
    } as any)).rejects.toThrow("exceeding maxMemberGridPoints=100");
  });
});
