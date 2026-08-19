import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "../src/core/profile.js";
import type { DecodedValue } from "../src/core/types.js";
import type { ProfileQuery } from "../src/schema/query.js";

const query: ProfileQuery = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-19T06:00:00Z",
  validTime: "2026-08-19T12:00:00Z",
  variables: ["temperature", "relative_humidity", "wind"],
  pressureLevelsHpa: [700, 850],
};

const gridPoint = { latitude: 50, longitude: 14.5 };
const fullValues: DecodedValue[] = [
  { code: "TMP", pressureHpa: 850, value: 285.15, gridPoint },
  { code: "RH", pressureHpa: 850, value: 65, gridPoint },
  { code: "UGRD", pressureHpa: 850, value: 3, gridPoint },
  { code: "VGRD", pressureHpa: 850, value: 4, gridPoint },
  { code: "TMP", pressureHpa: 700, value: 273.15, gridPoint },
  { code: "RH", pressureHpa: 700, value: 40, gridPoint },
  { code: "UGRD", pressureHpa: 700, value: -10, gridPoint },
  { code: "VGRD", pressureHpa: 700, value: 0, gridPoint },
];

function harness(values: DecodedValue[], cacheHit = false) {
  const fetchMock = vi.fn(async (_url: string) => ({ path: "/cache/field.grib2", cacheHit }));
  const decodeMock = vi.fn(async (_path: string, _longitude: number, _latitude: number) => values);
  const service = new ProfileService({
    cache: { fetch: fetchMock },
    decoder: { extractPoint: decodeMock },
  });
  return { service, fetchMock, decodeMock };
}

describe("ProfileService", () => {
  it("orchestrates query planning, decoding, unit conversion, wind derivation, and output metadata", async () => {
    const { service, fetchMock, decodeMock } = harness(fullValues);
    const result = await service.getProfile(query);

    expect(result).toMatchObject({
      model: "gfs_0p25",
      run: "2026-08-19T06:00:00.000Z",
      validTime: "2026-08-19T12:00:00.000Z",
      forecastHour: 6,
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint,
      source: { provider: "NOAA NOMADS", decoder: "wgrib2", cacheHit: false },
    });
    expect(result.levels.map((level) => level.pressureHpa)).toEqual([850, 700]);
    expect(result.levels[0]).toMatchObject({
      temperatureC: 12,
      relativeHumidityPct: 65,
      uWindMs: 3,
      vWindMs: 4,
      windSpeedMs: 5,
    });
    expect(result.levels[0]?.windDirectionDeg).toBeCloseTo(216.87, 1);
    expect(result.levels[1]?.temperatureC).toBeCloseTo(0);
    expect(result.levels[1]?.windDirectionDeg).toBeCloseTo(90);

    expect(decodeMock).toHaveBeenCalledWith("/cache/field.grib2", 14.43, 50.08);
    const url = new URL(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url.searchParams.get("var_TMP")).toBe("on");
    expect(url.searchParams.get("var_RH")).toBe("on");
    expect(url.searchParams.get("var_UGRD")).toBe("on");
    expect(url.searchParams.get("var_VGRD")).toBe("on");
    expect(url.searchParams.get("lev_850_mb")).toBe("on");
    expect(url.searchParams.get("lev_700_mb")).toBe("on");
  });

  it("propagates cache-hit provenance", async () => {
    const { service } = harness(fullValues, true);
    expect((await service.getProfile(query)).source.cacheHit).toBe(true);
  });

  it("does not derive wind when only raw U/V components are requested", async () => {
    const values = fullValues.filter((value) => value.pressureHpa === 850 && ["UGRD", "VGRD"].includes(value.code));
    const { service } = harness(values);
    const result = await service.getProfile({
      ...query,
      variables: ["u_wind", "v_wind"],
      pressureLevelsHpa: [850],
    });

    expect(result.levels[0]).toMatchObject({ uWindMs: 3, vWindMs: 4 });
    expect(result.levels[0]?.windSpeedMs).toBeUndefined();
    expect(result.levels[0]?.windDirectionDeg).toBeUndefined();
  });

  it("leaves derived wind absent when one component is missing", async () => {
    const { service } = harness([{ code: "UGRD", pressureHpa: 850, value: 3, gridPoint }]);
    const result = await service.getProfile({ ...query, variables: ["wind"], pressureLevelsHpa: [850] });
    expect(result.levels[0]?.uWindMs).toBe(3);
    expect(result.levels[0]?.windSpeedMs).toBeUndefined();
  });

  it("preserves requested levels even when NOAA has no decoded value for one of them", async () => {
    const { service } = harness([{ code: "TMP", pressureHpa: 850, value: 280, gridPoint }]);
    const result = await service.getProfile({ ...query, variables: ["temperature"], pressureLevelsHpa: [850, 700] });
    expect(result.levels).toHaveLength(2);
    expect(result.levels[1]).toEqual({ pressureHpa: 700 });
  });

  it("ignores decoded values for levels that were not requested", async () => {
    const { service } = harness([
      { code: "TMP", pressureHpa: 850, value: 280, gridPoint },
      { code: "TMP", pressureHpa: 500, value: 250, gridPoint },
    ]);
    const result = await service.getProfile({ ...query, variables: ["temperature"], pressureLevelsHpa: [850] });
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.pressureHpa).toBe(850);
  });

  it("deduplicates repeated requested pressure levels in the result", async () => {
    const { service } = harness([{ code: "TMP", pressureHpa: 850, value: 280, gridPoint }]);
    const result = await service.getProfile({
      ...query,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 850],
    });
    expect(result.levels).toHaveLength(1);
  });

  it("normalizes timezone-offset run and valid times to UTC", async () => {
    const { service } = harness([{ code: "TMP", pressureHpa: 850, value: 280, gridPoint }]);
    const result = await service.getProfile({
      ...query,
      run: "2026-08-19T08:00:00+02:00",
      validTime: "2026-08-19T14:00:00+02:00",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    expect(result.run).toBe("2026-08-19T06:00:00.000Z");
    expect(result.validTime).toBe("2026-08-19T12:00:00.000Z");
    expect(result.forecastHour).toBe(6);
  });

  it("fails when the decoder returns no supported values", async () => {
    const { service } = harness([]);
    await expect(service.getProfile(query)).rejects.toThrow(/No values decoded/);
  });

  it("validates input before touching cache or decoder dependencies", async () => {
    const { service, fetchMock, decodeMock } = harness(fullValues);
    await expect(service.getProfile({ ...query, latitude: 91 })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decodeMock).not.toHaveBeenCalled();
  });
});
