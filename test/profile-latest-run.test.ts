import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "../src/core/profile.js";
import type { DecodedValue } from "../src/core/types.js";

const gridPoint = { latitude: 50, longitude: 14.5 };
const values: DecodedValue[] = [
  { code: "TMP", pressureHpa: 850, value: 285.15, gridPoint },
];

function harness(resolvedRun = new Date("2026-08-19T06:00:00Z")) {
  const fetchMock = vi.fn(async (_url: string) => ({ path: "/cache/field.grib2", cacheHit: false }));
  const decodeMock = vi.fn(async () => values);
  const resolveLatestRun = vi.fn(async () => resolvedRun);
  const service = new ProfileService({
    cache: { fetch: fetchMock },
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
  it("resolves latest when the run selector is explicit", async () => {
    const { service, fetchMock, resolveLatestRun } = harness();
    const result = await service.getProfile({ ...base, run: "latest" });

    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(result.run).toBe("2026-08-19T06:00:00.000Z");
    expect(result.forecastHour).toBe(6);
    expect(new URL(fetchMock.mock.calls[0]?.[0] ?? "").searchParams.get("file")).toBe(
      "gfs.t06z.pgrb2.0p25.f006",
    );
  });

  it("uses latest when run is omitted", async () => {
    const { service, resolveLatestRun } = harness();
    const result = await service.getProfile(base);
    expect(resolveLatestRun).toHaveBeenCalledOnce();
    expect(result.run).toBe("2026-08-19T06:00:00.000Z");
  });

  it("does not invoke discovery for an explicit model run", async () => {
    const { service, resolveLatestRun } = harness();
    const result = await service.getProfile({ ...base, run: "2026-08-19T00:00:00Z" });
    expect(resolveLatestRun).not.toHaveBeenCalled();
    expect(result.forecastHour).toBe(12);
  });

  it("fails before NOMADS access if latest-run discovery fails", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ path: "/cache/field.grib2", cacheHit: false }));
    const service = new ProfileService({
      cache: { fetch: fetchMock },
      decoder: { extractPoint: vi.fn(async () => values) },
      latestRunProvider: {
        resolveLatestRun: vi.fn(async () => {
          throw new Error("No complete run");
        }),
      },
    });

    await expect(service.getProfile(base)).rejects.toThrow("No complete run");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still validates the resolved run against the requested valid time", async () => {
    const { service, fetchMock } = harness(new Date("2026-08-19T12:00:00Z"));
    await expect(
      service.getProfile({ ...base, validTime: "2026-08-19T11:00:00Z" }),
    ).rejects.toThrow(/at or after run time/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
