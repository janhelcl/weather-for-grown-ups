import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "../src/core/profile.js";
import type { DecodedValue } from "../src/core/types.js";
import type { ProfileDataSource } from "../src/sources/types.js";

const gridPoint = { latitude: 50, longitude: 14.5 };
const values: DecodedValue[] = [
  { code: "TMP", pressureHpa: 850, value: 285.15, gridPoint },
  { code: "UGRD", pressureHpa: 850, value: 3, gridPoint },
  { code: "VGRD", pressureHpa: 850, value: 4, gridPoint },
];

describe("ProfileService S3 source selection", () => {
  it("routes an S3 query through the S3 source and reports provenance", async () => {
    const fetch = vi.fn(async () => ({ path: "/cache/s3-fragment.grib2", cacheHit: false }));
    const s3Source: ProfileDataSource = {
      id: "s3",
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      fetch,
    };
    const decoder = { extractPoint: vi.fn(async () => values) };
    const service = new ProfileService({ sources: { s3: s3Source }, decoder });

    const result = await service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-19T06:00:00Z",
      validTime: "2026-08-19T12:00:00Z",
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850],
      source: "s3",
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toMatchObject({
      run: new Date("2026-08-19T06:00:00Z"),
      forecastHour: 6,
      latitude: 50.08,
      longitude: 14.43,
      pressureLevelsHpa: [850],
    });
    expect(fetch.mock.calls[0]?.[0].variables.map((variable) => variable.gfsCode)).toEqual(["TMP", "UGRD", "VGRD"]);
    expect(decoder.extractPoint).toHaveBeenCalledWith("/cache/s3-fragment.grib2", 14.43, 50.08);
    expect(result.source).toEqual({
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "wgrib2",
      cacheHit: false,
    });
    expect(result.levels[0]).toMatchObject({ temperatureC: 12, windSpeedMs: 5 });
  });

  it("keeps NOMADS as the default source for compatibility and smaller geographic transfers", async () => {
    const nomadsFetch = vi.fn(async () => ({ path: "/cache/nomads.grib2", cacheHit: true }));
    const service = new ProfileService({
      cache: { fetch: nomadsFetch },
      decoder: { extractPoint: vi.fn(async () => values) },
    });

    const result = await service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-19T06:00:00Z",
      validTime: "2026-08-19T12:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });

    expect(nomadsFetch).toHaveBeenCalledOnce();
    expect(result.source).toEqual({
      provider: "NOAA NOMADS",
      access: "nomads_grib_filter",
      decoder: "wgrib2",
      cacheHit: true,
    });
  });
});
