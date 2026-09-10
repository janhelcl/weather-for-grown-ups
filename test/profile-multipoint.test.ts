import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "../src/core/profile.js";
import type { ProfileDataRequest, ProfileDataSource } from "../src/sources/types.js";
import type { DecodedValue } from "../src/types/decoded.js";

const run = "2026-08-19T06:00:00Z";
const validTime = "2026-08-19T12:00:00Z";
const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 48.2, longitude: 16.37 },
] as const;

function source(
  id: "s3" | "nomads",
  fetch: (request: ProfileDataRequest) => Promise<{ path: string; cacheHit: boolean }>,
): ProfileDataSource {
  return id === "s3"
    ? { id, provider: "NOAA AWS Open Data", access: "s3_range", fetch }
    : { id, provider: "NOAA NOMADS", access: "nomads_grib_filter", fetch };
}

describe("ProfileService multi-point artifact reuse", () => {
  it("fetches one S3 artifact and decodes all requested points from it", async () => {
    const fetchMock = vi.fn(async (_request: ProfileDataRequest) => ({
      path: "/cache/global-fields.grib2",
      cacheHit: true,
    }));
    const extractPoint = vi.fn(async (): Promise<DecodedValue[]> => []);
    const extractPoints = vi.fn(async (
      _path: string,
      requested: readonly { latitude: number; longitude: number }[],
    ): Promise<DecodedValue[][]> => requested.map((point, index) => [{
      code: "TMP",
      pressureHpa: 850,
      value: 280 + index,
      gridPoint: { latitude: point.latitude, longitude: point.longitude },
    }]));
    const service = new ProfileService({
      sources: { s3: source("s3", fetchMock) },
      decoder: { engine: "gribberish", extractPoint, extractPoints },
    });

    const result = await service.getProfiles({
      latitude: points[0].latitude,
      longitude: points[0].longitude,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      source: "s3",
    }, points);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toMatchObject({
      latitude: points[0].latitude,
      longitude: points[0].longitude,
      forecastHour: 6,
    });
    expect(extractPoints).toHaveBeenCalledWith("/cache/global-fields.grib2", points, undefined);
    expect(extractPoint).not.toHaveBeenCalled();
    expect(result.map((profile) => profile.requestedPoint)).toEqual(points);
    expect(result[0]?.levels[0]?.temperatureC).toBeCloseTo(6.85, 10);
    expect(result[1]?.levels[0]?.temperatureC).toBeCloseTo(7.85, 10);
    expect(result.every((profile) => profile.source.cacheHit)).toBe(true);
  });

  it("rejects multi-point reuse for spatially subsetted NOMADS artifacts", async () => {
    const fetchMock = vi.fn(async (_request: ProfileDataRequest) => ({
      path: "/cache/local-subset.grib2",
      cacheHit: false,
    }));
    const service = new ProfileService({
      sources: { nomads: source("nomads", fetchMock) },
      decoder: { extractPoint: vi.fn(async () => []) },
    });

    await expect(service.getProfiles({
      latitude: points[0].latitude,
      longitude: points[0].longitude,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      source: "nomads",
    }, points)).rejects.toThrow(/requires the NOAA AWS S3 source/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty result without touching providers when there are no points", async () => {
    const service = new ProfileService();
    await expect(service.getProfiles({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      source: "s3",
    }, [])).resolves.toEqual([]);
  });
});
