import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "../src/core/profile.js";
import type { DecodedValue } from "../src/core/types.js";

const query = {
  latitude: 50.08, longitude: 14.43, run: "2026-08-19T06:00:00Z",
  validTime: "2026-08-19T12:00:00Z", variables: ["temperature", "relative_humidity", "wind"] as const,
  pressureLevelsHpa: [700, 850],
};
const gridPoint = { latitude: 50, longitude: 14.5 };
const fullValues: DecodedValue[] = [
  { code: "TMP", pressureHpa: 850, value: 285.15, gridPoint }, { code: "RH", pressureHpa: 850, value: 65, gridPoint },
  { code: "UGRD", pressureHpa: 850, value: 3, gridPoint }, { code: "VGRD", pressureHpa: 850, value: 4, gridPoint },
  { code: "TMP", pressureHpa: 700, value: 273.15, gridPoint }, { code: "RH", pressureHpa: 700, value: 40, gridPoint },
  { code: "UGRD", pressureHpa: 700, value: -10, gridPoint }, { code: "VGRD", pressureHpa: 700, value: 0, gridPoint },
];

function harness(values: DecodedValue[], cacheHit = false) {
  const fetchMock = vi.fn(async (_url: string) => ({ path: "/cache/field.grib2", cacheHit }));
  const decodeMock = vi.fn(async () => values);
  const service = new ProfileService({ cache: { fetch: fetchMock }, decoder: { extractPoint: decodeMock } });
  return { service, fetchMock, decodeMock };
}

describe("ProfileService", () => {
  it("orchestrates query planning, decoding, unit conversion, wind derivation, and metadata", async () => {
    const { service, fetchMock, decodeMock } = harness(fullValues);
    const result = await service.getProfile(query);
    expect(result).toMatchObject({
      model: "gfs_0p25", run: "2026-08-19T06:00:00.000Z", validTime: "2026-08-19T12:00:00.000Z",
      forecastHour: 6, requestedPoint: { latitude: 50.08, longitude: 14.43 }, gridPoint,
      source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: false },
    });
    expect(result.levels.map((level) => level.pressureHpa)).toEqual([850, 700]);
    expect(result.levels[0]).toMatchObject({ temperatureC: 12, relativeHumidityPct: 65, uWindMs: 3, vWindMs: 4, windSpeedMs: 5 });
    expect(result.levels[0]?.windDirectionDeg).toBeCloseTo(216.87, 1);
    expect(result.levels[1]?.temperatureC).toBeCloseTo(0);
    expect(result.levels[1]?.windDirectionDeg).toBeCloseTo(90);
    expect(decodeMock).toHaveBeenCalledWith("/cache/field.grib2", 14.43, 50.08);
    const url = new URL(fetchMock.mock.calls[0]?.[0] ?? "");
    for (const code of ["TMP", "RH", "UGRD", "VGRD"]) expect(url.searchParams.get(`var_${code}`)).toBe("on");
  });

  it("maps every expanded raw variable into canonical output fields", async () => {
    const values: DecodedValue[] = [
      { code: "HGT", pressureHpa: 850, value: 1500, gridPoint },
      { code: "SPFH", pressureHpa: 850, value: 0.006, gridPoint },
      { code: "VVEL", pressureHpa: 850, value: -0.2, gridPoint },
      { code: "DZDT", pressureHpa: 850, value: 0.03, gridPoint },
      { code: "ABSV", pressureHpa: 850, value: 0.00012, gridPoint },
      { code: "TCDC", pressureHpa: 850, value: 42, gridPoint },
      { code: "CLWMR", pressureHpa: 850, value: 0.0004, gridPoint },
      { code: "O3MR", pressureHpa: 850, value: 2e-7, gridPoint },
    ];
    const { service } = harness(values);
    const result = await service.getProfile({
      ...query,
      variables: ["geopotential_height", "specific_humidity", "vertical_velocity", "geometric_vertical_velocity", "absolute_vorticity", "total_cloud_cover", "cloud_water_mixing_ratio", "ozone_mixing_ratio"],
      pressureLevelsHpa: [850],
    });
    expect(result.levels[0]).toEqual({
      pressureHpa: 850, geopotentialHeightGpm: 1500, specificHumidityKgKg: 0.006,
      verticalVelocityPaS: -0.2, geometricVerticalVelocityMs: 0.03, absoluteVorticityS1: 0.00012,
      totalCloudCoverPct: 42, cloudWaterMixingRatioKgKg: 0.0004, ozoneMixingRatioKgKg: 2e-7,
    });
  });

  it("propagates cache-hit provenance", async () => {
    expect((await harness(fullValues, true).service.getProfile(query)).source.cacheHit).toBe(true);
  });

  it("does not derive wind when only raw U/V components are requested", async () => {
    const values = fullValues.filter((value) => value.pressureHpa === 850 && ["UGRD", "VGRD"].includes(value.code));
    const result = await harness(values).service.getProfile({ ...query, variables: ["u_wind", "v_wind"], pressureLevelsHpa: [850] });
    expect(result.levels[0]).toMatchObject({ uWindMs: 3, vWindMs: 4 });
    expect(result.levels[0]?.windSpeedMs).toBeUndefined();
  });

  it("rejects partial derived-wind data instead of silently omitting the derived value", async () => {
    const { service } = harness([{ code: "UGRD", pressureHpa: 850, value: 3, gridPoint }]);
    await expect(service.getProfile({ ...query, variables: ["wind"], pressureLevelsHpa: [850] })).rejects.toThrow(/VGRD@850mb/);
  });

  it("rejects a partial requested pressure profile instead of returning empty level shells", async () => {
    const { service } = harness([{ code: "TMP", pressureHpa: 850, value: 280, gridPoint }]);
    await expect(service.getProfile({ ...query, variables: ["temperature"], pressureLevelsHpa: [850, 700] })).rejects.toThrow(/TMP@700mb/);
  });

  it("ignores decoded values for unrequested levels after completeness is satisfied", async () => {
    const result = await harness([
      { code: "TMP", pressureHpa: 850, value: 280, gridPoint },
      { code: "TMP", pressureHpa: 500, value: 250, gridPoint },
    ]).service.getProfile({ ...query, variables: ["temperature"], pressureLevelsHpa: [850] });
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.pressureHpa).toBe(850);
  });

  it("deduplicates repeated requested pressure levels in the result and completeness check", async () => {
    const result = await harness([{ code: "TMP", pressureHpa: 850, value: 280, gridPoint }]).service.getProfile({
      ...query, variables: ["temperature"], pressureLevelsHpa: [850, 850],
    });
    expect(result.levels).toHaveLength(1);
  });

  it("normalizes timezone-offset run and valid times to UTC", async () => {
    const result = await harness([{ code: "TMP", pressureHpa: 850, value: 280, gridPoint }]).service.getProfile({
      ...query, run: "2026-08-19T08:00:00+02:00", validTime: "2026-08-19T14:00:00+02:00",
      variables: ["temperature"], pressureLevelsHpa: [850],
    });
    expect(result.run).toBe("2026-08-19T06:00:00.000Z");
    expect(result.validTime).toBe("2026-08-19T12:00:00.000Z");
  });

  it("fails clearly when the decoder returns no supported values", async () => {
    await expect(harness([]).service.getProfile(query)).rejects.toThrow(/No values decoded/);
  });

  it("validates input before touching cache or decoder dependencies", async () => {
    const { service, fetchMock, decodeMock } = harness(fullValues);
    await expect(service.getProfile({ ...query, pressureLevelsHpa: [842] })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decodeMock).not.toHaveBeenCalled();
  });
});
