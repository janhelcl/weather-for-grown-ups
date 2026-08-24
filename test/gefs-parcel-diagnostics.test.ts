import { describe, expect, it, vi } from "vitest";
import { GefsParcelDiagnosticsService } from "../src/core/gefs-parcel-diagnostics.js";

function memberValues(member: string) {
  const warm = member === "p01" ? 1 : 0;
  const gridPoint = { latitude: 50, longitude: 14.5 };
  return [
    { code: "PRES", surface: true as const, value: 100000, gridPoint },
    { code: "TMP", heightAboveGroundM: 2, value: 303.15 + warm, gridPoint },
    { code: "RH", heightAboveGroundM: 2, value: 70, gridPoint },
    { code: "TMP", pressureHpa: 925, value: 298.15 + warm, gridPoint },
    { code: "RH", pressureHpa: 925, value: 70, gridPoint },
    { code: "HGT", pressureHpa: 925, value: 750, gridPoint },
    { code: "TMP", pressureHpa: 850, value: 288.15 + warm, gridPoint },
    { code: "RH", pressureHpa: 850, value: 65, gridPoint },
    { code: "HGT", pressureHpa: 850, value: 1500, gridPoint },
    { code: "TMP", pressureHpa: 700, value: 273.15 + warm, gridPoint },
    { code: "RH", pressureHpa: 700, value: 60, gridPoint },
    { code: "HGT", pressureHpa: 700, value: 3000, gridPoint },
    { code: "TMP", pressureHpa: 500, value: 251.15 + warm, gridPoint },
    { code: "RH", pressureHpa: 500, value: 45, gridPoint },
    { code: "HGT", pressureHpa: 500, value: 5600, gridPoint },
    { code: "TMP", pressureHpa: 250, value: 248.15 + warm, gridPoint },
    { code: "RH", pressureHpa: 250, value: 25, gridPoint },
    { code: "HGT", pressureHpa: 250, value: 10400, gridPoint },
  ];
}

describe("GEFS parcel diagnostics service", () => {
  it("derives parcels independently per member and summarizes structural outputs", async () => {
    const fetchSelection = vi.fn(async (request) => ({
      path: `${request.member}:${request.forecastHour === 0 && request.fields?.[0]?.id === "surface_geopotential_height" ? "orography" : "forecast"}`,
      cacheHit: request.member === "c00",
    }));
    const service = new GefsParcelDiagnosticsService({
      concurrency: 1,
      source: { fetchSelection },
      decoder: {
        extractPoint: vi.fn(async (path) => {
          const [member, kind] = path.split(":");
          if (kind === "orography") {
            return [{ code: "HGT", surface: true, value: 100, gridPoint: { latitude: 50, longitude: 14.5 } }];
          }
          return memberValues(member!);
        }),
      },
    });

    const result = await service.getParcelDiagnostics({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-24T00:00:00Z",
      validTime: "2026-08-24T06:00:00Z",
      pressureLevelsHpa: [250, 500, 700, 850, 925],
      parcel: "surface_2m",
      members: ["p01", "c00"],
      quantiles: [0, 0.5, 1],
      includeMembers: true,
    });

    expect(fetchSelection).toHaveBeenCalledTimes(4); // forecast + f000 terrain for each member
    expect(result.selection.members).toEqual(["c00", "p01"]);
    expect(result.sampledPressureLevelsHpa).toEqual([925, 850, 700, 500, 250]);
    expect(result.methodology.surfaceOrography).toBe("same_cycle_f000_surface_geopotential_height");
    expect(result.members).toHaveLength(2);
    expect(result.members?.[0]?.levels[0]).toMatchObject({
      pressureHpa: 925,
      temperatureC: 25,
      relativeHumidityPct: 70,
    });
    expect(result.members?.[0]?.levels[0]?.specificHumidityKgKg).toBeGreaterThan(0);
    expect(Number.isFinite(result.summary.capeJkg.mean)).toBe(true);
    expect(Number.isFinite(result.summary.cinJkg.mean)).toBe(true);
    expect(result.summary.membersWithPositiveCape.interpretation).toBe("raw_member_fraction_not_calibrated_probability");
    expect(result.source.allCacheHit).toBe(false);
  });

  it("keeps member structures omitted by default while retaining compact summaries", async () => {
    const service = new GefsParcelDiagnosticsService({
      source: {
        fetchSelection: async (request) => ({
          path: `${request.member}:${request.forecastHour === 0 && request.fields?.[0]?.id === "surface_geopotential_height" ? "orography" : "forecast"}`,
          cacheHit: true,
        }),
      },
      decoder: {
        extractPoint: async (path) => path.endsWith(":orography")
          ? [{ code: "HGT", surface: true, value: 100, gridPoint: { latitude: 50, longitude: 14.5 } }]
          : memberValues(path.split(":")[0]!),
      },
    });
    const result = await service.getParcelDiagnostics({
      latitude: 50,
      longitude: 14.5,
      run: "2026-08-24T00:00:00Z",
      validTime: "2026-08-24T06:00:00Z",
      pressureLevelsHpa: [925, 850, 700, 500, 250],
      parcel: "surface_2m",
      members: ["c00", "p01"],
    });
    expect(result.members).toBeUndefined();
    expect(result.source.allCacheHit).toBe(true);
  });

  it("rejects grid drift between forecast fields and f000 orography", async () => {
    const service = new GefsParcelDiagnosticsService({
      source: {
        fetchSelection: async (request) => ({ path: request.forecastHour === 0 ? "orography" : "forecast", cacheHit: true }),
      },
      decoder: {
        extractPoint: async (path) => path === "orography"
          ? [{ code: "HGT", surface: true, value: 100, gridPoint: { latitude: 50.5, longitude: 14.5 } }]
          : memberValues("c00"),
      },
    });
    await expect(service.getParcelDiagnostics({
      latitude: 50,
      longitude: 14.5,
      run: "2026-08-24T00:00:00Z",
      validTime: "2026-08-24T06:00:00Z",
      pressureLevelsHpa: [925, 850, 700, 500, 250],
      parcel: "surface_2m",
      members: ["c00", "p01"],
    })).rejects.toThrow("inconsistent grid points");
  });
});
