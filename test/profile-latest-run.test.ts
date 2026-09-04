import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "../src/core/profile.js";
import type { DecodedValue } from "../src/types/decoded.js";
import type { ProfileDataRequest, ProfileDataSource } from "../src/sources/types.js";

const gridPoint = { latitude: 50, longitude: 14.5 };
const values: DecodedValue[] = [
  { code: "TMP", pressureHpa: 850, value: 285.15, gridPoint },
];

function source(fetch: (request: ProfileDataRequest) => Promise<{ path: string; cacheHit: boolean }>): ProfileDataSource {
  return {
    id: "nomads",
    provider: "NOAA NOMADS",
    access: "nomads_grib_filter",
    fetch,
  };
}

function harness(resolvedRun = new Date("2026-08-19T06:00:00Z")) {
  const fetchMock = vi.fn(async (_request: ProfileDataRequest) => ({ path: "/cache/field.grib2", cacheHit: false }));
  const decodeMock = vi.fn(async () => values);
  const resolveLatestRun = vi.fn(async () => resolvedRun);
  const service = new ProfileService({
    sources: { nomads: source(fetchMock) },
    decoder: { extractPoint: decodeMock },
    latestRunProvider: { resolveLatestRun },
  });
  return { service, fetchMock, decodeMock, resolveLatestRun };
}

const base = {
  latitude: 50.08,
  longitude: 14.43,
  validTime: "2026-08-19T12:00:00Z",
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
};

describe("ProfileService latest-run selection", () => {
  it("resolves latest against the exact valid time and expanded field selection", async () => {
    const { service, fetchMock, resolveLatestRun } = harness();
    const result = await service.getProfile({ ...base, run: "latest" });

    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(resolveLatestRun).toHaveBeenCalledWith({
      type: "valid_time",
      validTime: new Date("2026-08-19T12:00:00Z"),
      selection: {
        variableCodes: ["TMP"],
        pressureLevelsHpa: [850],
        fields: [],
      },
    });
    expect(result.run).toBe("2026-08-19T06:00:00.000Z");
    expect(result.forecastHour).toBe(6);
    expect(fetchMock.mock.calls[0]?.[0]).toMatchObject({
      run: new Date("2026-08-19T06:00:00Z"),
      forecastHour: 6,
      latitude: 50.08,
      longitude: 14.43,
    });
  });

  it("uses query-aware latest when run is omitted", async () => {
    const { service, resolveLatestRun } = harness();
    const result = await service.getProfile(base);
    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(resolveLatestRun.mock.calls[0]?.[0]).toMatchObject({ type: "valid_time" });
    expect(result.run).toBe("2026-08-19T06:00:00.000Z");
  });

  it("propagates explicit 0.5 grid through latest-run discovery and the canonical source request", async () => {
    const { service, fetchMock, resolveLatestRun } = harness();
    const result = await service.getProfile({ ...base, run: "latest", grid: "0p50" });

    expect(resolveLatestRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: "valid_time" }),
      "0p50",
    );
    expect(result.model).toBe("gfs_0p50");
    expect(fetchMock.mock.calls[0]?.[0].grid).toBe("0p50");
  });

  it("uses grid-aware complete-run discovery for 0.5", async () => {
    const { service, resolveLatestRun } = harness();
    await service.getProfile({ ...base, run: "latest_complete", grid: "0p50" });
    expect(resolveLatestRun).toHaveBeenCalledWith(undefined, "0p50");
  });

  it("uses complete-run discovery when latest_complete is requested", async () => {
    const { service, resolveLatestRun } = harness();
    await service.getProfile({ ...base, run: "latest_complete" });
    expect(resolveLatestRun).toHaveBeenCalledWith();
  });

  it("does not invoke discovery for an explicit model run", async () => {
    const { service, resolveLatestRun } = harness();
    const result = await service.getProfile({ ...base, run: "2026-08-19T00:00:00Z" });
    expect(resolveLatestRun).not.toHaveBeenCalled();
    expect(result.forecastHour).toBe(12);
  });

  it("fails before source access if latest-run discovery fails", async () => {
    const fetchMock = vi.fn(async (_request: ProfileDataRequest) => ({ path: "/cache/field.grib2", cacheHit: false }));
    const service = new ProfileService({
      sources: { nomads: source(fetchMock) },
      decoder: { extractPoint: vi.fn(async () => values) },
      latestRunProvider: {
        resolveLatestRun: vi.fn(async () => {
          throw new Error("No satisfying run");
        }),
      },
    });

    await expect(service.getProfile(base)).rejects.toThrow("No satisfying run");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still validates a mocked resolved run against the requested valid time", async () => {
    const { service, fetchMock } = harness(new Date("2026-08-19T12:00:00Z"));
    await expect(
      service.getProfile({ ...base, validTime: "2026-08-19T11:00:00Z" }),
    ).rejects.toThrow(/at or after run time/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
