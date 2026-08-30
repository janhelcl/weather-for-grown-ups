import { describe, expect, it, vi } from "vitest";
import { greatCircleDistanceKm, interpolateGreatCircle, TransectService } from "../src/core/transect.js";
import { transectResultSchema } from "../src/schema/transect-result.js";
import type { BatchPointsQueryInput } from "../src/schema/query.js";

const source = {
  provider: "NOAA AWS Open Data" as const,
  access: "s3_range" as const,
  decoder: "wgrib2" as const,
  cacheHit: false,
};

function batchResult(query: BatchPointsQueryInput) {
  const points = query.points ?? [];
  return {
    model: query.grid === "0p50" ? "gfs_0p50" as const : "gfs_0p25" as const,
    run: "2026-08-24T06:00:00.000Z",
    validTime: "2026-08-24T12:00:00.000Z",
    forecastHour: 6,
    points: points.map((point) => ({
      requestedPoint: point,
      gridPoint: point,
      levels: query.variables === undefined ? [] : [
        { pressureHpa: 850, temperatureC: 12, windSpeedMs: 5 },
        { pressureHpa: 700, temperatureC: 2, windSpeedMs: 8 },
      ],
      ...(query.fields === undefined ? {} : {
        fields: query.fields.map((id) => ({
          id,
          level: id === "temperature_2m"
            ? { type: "height_above_ground_m" as const, heightM: 2 }
            : { type: "height_above_ground_m" as const, heightM: 10 },
          temporal: { type: "instantaneous" as const },
          values: id === "temperature_2m"
            ? { temperatureC: 12 }
            : { windSpeedMs: 5, windDirectionDeg: 270 },
        })),
      }),
    })),
    source,
  };
}

describe("great-circle transect geometry", () => {
  it("computes a known equatorial distance", () => {
    expect(greatCircleDistanceKm(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
    )).toBeCloseTo(1111.95, 1);
  });

  it("includes exact endpoints and evenly spaced great-circle samples", () => {
    const points = interpolateGreatCircle(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      3,
    );
    expect(points[0]).toEqual({ latitude: 0, longitude: 0 });
    expect(points[1]?.latitude).toBeCloseTo(0, 10);
    expect(points[1]?.longitude).toBeCloseTo(5, 10);
    expect(points[2]).toEqual({ latitude: 0, longitude: 10 });
  });

  it("takes the short route across the antimeridian", () => {
    const points = interpolateGreatCircle(
      { latitude: 0, longitude: 170 },
      { latitude: 0, longitude: -170 },
      3,
    );
    expect(Math.abs(points[1]?.longitude ?? 0)).toBeCloseTo(180, 8);
    expect(greatCircleDistanceKm(
      { latitude: 0, longitude: 170 },
      { latitude: 0, longitude: -170 },
    )).toBeCloseTo(2223.9, 0);
  });

  it("rejects degenerate and antipodal interpolation", () => {
    expect(() => interpolateGreatCircle(
      { latitude: 1, longitude: 2 },
      { latitude: 1, longitude: 2 },
      3,
    )).toThrow(/must differ/);
    expect(() => interpolateGreatCircle(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 180 },
      3,
    )).toThrow(/antipodal/);
  });
});

describe("TransectService", () => {
  it("uses one batched pressure query and adds along-track metadata", async () => {
    const getPoints = vi.fn(async (query: BatchPointsQueryInput) => batchResult(query));
    const result = await new TransectService({ batchPointsGetter: { getPoints } }).getTransect({
      start: { latitude: 0, longitude: 0 },
      end: { latitude: 0, longitude: 10 },
      run: "2026-08-24T06:00:00Z",
      validTime: "2026-08-24T12:00:00Z",
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850, 700],
      samples: 3,
    });

    expect(getPoints).toHaveBeenCalledTimes(1);
    const query = getPoints.mock.calls[0]?.[0];
    expect(query).toMatchObject({
      run: "2026-08-24T06:00:00Z",
      validTime: "2026-08-24T12:00:00Z",
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850, 700],
    });
    expect(query?.points).toHaveLength(3);
    expect(result.samples.map((sample) => sample.fraction)).toEqual([0, 0.5, 1]);
    expect(result.samples[1]?.distanceKm).toBeCloseTo(result.totalDistanceKm / 2, 10);
    expect(result.samples[1]?.levels).toHaveLength(2);
    expect(result.source).toEqual(source);
    expect(transectResultSchema.parse(result)).toEqual(result);
  });

  it("passes mixed pressure/field selection through one batch and preserves fields", async () => {
    const getPoints = vi.fn(async (query: BatchPointsQueryInput) => batchResult(query));
    const result = await new TransectService({ batchPointsGetter: { getPoints } }).getTransect({
      start: { latitude: 0, longitude: 0 },
      end: { latitude: 0, longitude: 10 },
      run: "2026-08-24T06:00:00Z",
      grid: "0p50",
      validTime: "2026-08-24T12:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850, 700],
      fields: ["temperature_2m", "wind_10m"],
      samples: 3,
    });

    expect(getPoints).toHaveBeenCalledWith(expect.objectContaining({
      grid: "0p50",
      variables: ["temperature"],
      pressureLevelsHpa: [850, 700],
      fields: ["temperature_2m", "wind_10m"],
    }));
    expect(result.model).toBe("gfs_0p50");
    expect(result.fields).toEqual(["temperature_2m", "wind_10m"]);
    expect(result.samples.every((sample) => sample.fields?.length === 2)).toBe(true);
    expect(transectResultSchema.parse(result)).toEqual(result);
  });

  it("supports field-only transects with empty pressure arrays", async () => {
    const result = await new TransectService({
      batchPointsGetter: { getPoints: async (query) => batchResult(query) },
    }).getTransect({
      start: { latitude: 0, longitude: 0 },
      end: { latitude: 0, longitude: 10 },
      validTime: "2026-08-24T12:00:00Z",
      fields: ["temperature_2m"],
      samples: 2,
    });

    expect(result.variables).toEqual([]);
    expect(result.pressureLevelsHpa).toEqual([]);
    expect(result.fields).toEqual(["temperature_2m"]);
    expect(result.samples.every((sample) => sample.levels.length === 0)).toBe(true);
    expect(transectResultSchema.parse(result)).toEqual(result);
  });

  it("preserves the batch-resolved run and forecast metadata", async () => {
    const result = await new TransectService({ batchPointsGetter: { getPoints: async (query) => batchResult(query) } }).getTransect({
      start: { latitude: 45, longitude: 10 },
      end: { latitude: 50, longitude: 15 },
      validTime: "2026-08-24T12:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      samples: 2,
    });
    expect(result.run).toBe("2026-08-24T06:00:00.000Z");
    expect(result.validTime).toBe("2026-08-24T12:00:00.000Z");
    expect(result.forecastHour).toBe(6);
  });

  it("fails if the batch service changes the sample cardinality", async () => {
    const service = new TransectService({
      batchPointsGetter: {
        getPoints: async (query) => ({ ...batchResult(query), points: [] }),
      },
    });
    await expect(service.getTransect({
      start: { latitude: 0, longitude: 0 },
      end: { latitude: 0, longitude: 10 },
      validTime: "2026-08-24T12:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      samples: 3,
    })).rejects.toThrow(/returned 0 points for 3 requested samples/);
  });
});
