import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "../src/core/profile.js";
import type { DecodedValue } from "../src/core/types.js";

const gridPoint = { latitude: 50, longitude: 14.5 };
const query = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-19T06:00:00Z",
  validTime: "2026-08-19T12:00:00Z",
  pressureLevelsHpa: [850],
};

function harness(values: DecodedValue[]) {
  const fetchMock = vi.fn(async (_url: string) => ({ path: "/cache/field.grib2", cacheHit: false }));
  const decodeMock = vi.fn(async () => values);
  const service = new ProfileService({ cache: { fetch: fetchMock }, decoder: { extractPoint: decodeMock } });
  return { service, fetchMock };
}

describe("ProfileService moist thermodynamics", () => {
  it("derives wet-bulb and equivalent potential temperature from one minimal raw selection", async () => {
    const { service, fetchMock } = harness([
      { code: "TMP", pressureHpa: 850, value: 285.15, gridPoint },
      { code: "SPFH", pressureHpa: 850, value: 0.006, gridPoint },
    ]);
    const result = await service.getProfile({
      ...query,
      variables: ["wet_bulb_temperature", "equivalent_potential_temperature"],
    });

    expect(result.levels[0]).toMatchObject({
      pressureHpa: 850,
      temperatureC: 12,
      specificHumidityKgKg: 0.006,
    });
    expect(result.levels[0]?.wetBulbTemperatureC).toBeCloseTo(7.691, 3);
    expect(result.levels[0]?.equivalentPotentialTemperatureK).toBeCloseTo(316.758, 3);

    const url = new URL(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url.searchParams.get("var_TMP")).toBe("on");
    expect(url.searchParams.get("var_SPFH")).toBe("on");
    for (const code of ["RH", "UGRD", "VGRD", "HGT"]) {
      expect(url.searchParams.get(`var_${code}`)).not.toBe("on");
    }
  });

  it("does not materialize moist derived outputs when only raw dependencies are requested", async () => {
    const result = await harness([
      { code: "TMP", pressureHpa: 850, value: 285.15, gridPoint },
      { code: "SPFH", pressureHpa: 850, value: 0.006, gridPoint },
    ]).service.getProfile({
      ...query,
      variables: ["temperature", "specific_humidity"],
    });
    expect(result.levels[0]).not.toHaveProperty("wetBulbTemperatureC");
    expect(result.levels[0]).not.toHaveProperty("equivalentPotentialTemperatureK");
  });

  it("fails loudly when a moist derived dependency is missing", async () => {
    const { service } = harness([{ code: "TMP", pressureHpa: 850, value: 285.15, gridPoint }]);
    await expect(service.getProfile({
      ...query,
      variables: ["wet_bulb_temperature"],
    })).rejects.toThrow(/SPFH@850mb/);
  });
});
