import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "../src/core/profile.js";
import type { DecodedValue } from "../src/core/types.js";

const gridPoint = { latitude: 50, longitude: 14.5 };

function serviceFor(values: DecodedValue[]) {
  const fetchMock = vi.fn(async (_url: string) => ({ path: "/cache/fields.grib2", cacheHit: false }));
  const decoder = { extractPoint: vi.fn(async () => values) };
  return { service: new ProfileService({ cache: { fetch: fetchMock }, decoder }), fetchMock };
}

const baseQuery = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-19T06:00:00Z",
  validTime: "2026-08-19T12:00:00Z",
};

describe("ProfileService non-isobaric fields", () => {
  it("returns fields-only results with explicit level semantics and normalized values", async () => {
    const values: DecodedValue[] = [
      { code: "PRES", surface: true, value: 100800, gridPoint },
      { code: "TMP", heightAboveGroundM: 2, value: 293.15, gridPoint },
      { code: "UGRD", heightAboveGroundM: 10, value: 3, gridPoint },
      { code: "VGRD", heightAboveGroundM: 10, value: 4, gridPoint },
    ];
    const { service } = serviceFor(values);
    const result = await service.getProfile({
      ...baseQuery,
      fields: ["surface_pressure", "temperature_2m", "wind_10m"],
    });

    expect(result.levels).toEqual([]);
    expect(result.fields).toEqual([
      {
        id: "surface_pressure",
        level: { type: "surface" },
        temporal: { type: "instantaneous" },
        values: { pressurePa: 100800 },
      },
      {
        id: "temperature_2m",
        level: { type: "height_above_ground_m", heightM: 2 },
        temporal: { type: "instantaneous" },
        values: { temperatureC: 20 },
      },
      {
        id: "wind_10m",
        level: { type: "height_above_ground_m", heightM: 10 },
        temporal: { type: "instantaneous" },
        values: { windSpeedMs: 5, windDirectionDeg: expect.any(Number) },
      },
    ]);
    expect(result.fields?.[2]?.values.windDirectionDeg).toBeCloseTo(216.87, 1);
  });

  it("returns the exact forecast interval and UTC times for precipitation accumulations", async () => {
    const { service } = serviceFor([
      {
        code: "APCP",
        surface: true,
        accumulation: { startForecastHour: 0, endForecastHour: 6 },
        value: 4.2,
        gridPoint,
      },
    ]);
    const result = await service.getProfile({ ...baseQuery, fields: ["total_precipitation"] });
    expect(result.fields).toEqual([
      {
        id: "total_precipitation",
        level: { type: "surface" },
        temporal: {
          type: "accumulation",
          startForecastHour: 0,
          endForecastHour: 6,
          startTime: "2026-08-19T06:00:00.000Z",
          endTime: "2026-08-19T12:00:00.000Z",
        },
        values: { totalPrecipitationMm: 4.2 },
      },
    ]);
  });

  it("can mix pressure-level and non-isobaric fields in one fetch", async () => {
    const values: DecodedValue[] = [
      { code: "TMP", pressureHpa: 850, value: 283.15, gridPoint },
      { code: "CAPE", surface: true, value: 1200, gridPoint },
    ];
    const { service, fetchMock } = serviceFor(values);
    const result = await service.getProfile({
      ...baseQuery,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["surface_cape"],
    });
    expect(result.levels[0]).toEqual({ pressureHpa: 850, temperatureC: 10 });
    expect(result.fields?.[0]).toMatchObject({ id: "surface_cape", values: { capeJkg: 1200 } });
    const url = new URL(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url.searchParams.get("lev_850_mb")).toBe("on");
    expect(url.searchParams.get("lev_surface")).toBe("on");
    expect(url.searchParams.get("var_TMP")).toBe("on");
    expect(url.searchParams.get("var_CAPE")).toBe("on");
  });

  it("rejects a decoded accumulation field without accumulation time metadata", async () => {
    const { service } = serviceFor([{ code: "APCP", surface: true, value: 1.5, gridPoint }]);
    await expect(service.getProfile({ ...baseQuery, fields: ["total_precipitation"] })).rejects.toThrow(/total_precipitation/);
  });

  it("rejects the right variable at the wrong height", async () => {
    const { service } = serviceFor([
      { code: "UGRD", heightAboveGroundM: 80, value: 3, gridPoint },
      { code: "VGRD", heightAboveGroundM: 80, value: 4, gridPoint },
    ]);
    await expect(service.getProfile({ ...baseQuery, fields: ["wind_100m"] })).rejects.toThrow(/u_wind_100m/);
  });
});
