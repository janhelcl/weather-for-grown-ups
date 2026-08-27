import { describe, expect, it, vi } from "vitest";
import { UnifiedForecastVerificationService } from "../src/core/unified-specialized-api.js";
import { verifyAtmosphericForecastSchema } from "../src/schema/unified-specialized.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

describe("unified IGRA verification schema", () => {
  it("accepts IGRA-only station and GFS grid controls", () => {
    const request = verifyAtmosphericForecastSchema.parse({
      referenceDataset: "igra",
      geometry: point,
      time: { at: "2026-08-24T12:00:00Z" },
      leadHours: 48,
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850, 700],
      gfsGrid: "0p25",
      stationId: "EZM00011520",
      maxStationDistanceKm: 100,
    });

    expect(request.referenceDataset).toBe("igra");
    expect(request.gfsGrid).toBe("0p25");
  });

  it("rejects unsupported IGRA variables", () => {
    expect(() => verifyAtmosphericForecastSchema.parse({
      referenceDataset: "igra",
      geometry: point,
      time: { at: "2026-08-24T12:00:00Z" },
      leadHours: 48,
      variables: ["vertical_velocity"],
      pressureLevelsHpa: [850],
    })).toThrow(/IGRA verification supports only/);
  });

  it("does not leak IGRA-specific controls into the legacy analysis reference", () => {
    expect(() => verifyAtmosphericForecastSchema.parse({
      referenceDataset: "gfs-analysis",
      geometry: point,
      time: { at: "2019-12-26T18:00:00Z" },
      leadHours: 54,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      stationId: "EZM00011520",
    })).toThrow(/only valid when referenceDataset=igra/);
  });
});

describe("UnifiedForecastVerificationService", () => {
  it("preserves gfs-analysis as the default reference", async () => {
    const analysis = { verify: vi.fn(async () => ({ route: "analysis" })) };
    const igra = { verify: vi.fn(async () => ({ route: "igra" })) };
    const service = new UnifiedForecastVerificationService(analysis as any, igra as any);

    const result = await service.verify({
      geometry: point,
      time: { at: "2019-12-26T18:00:00Z" },
      leadHours: 54,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });

    expect(result.datasets).toEqual(["gfs", "gfs-analysis"]);
    expect((result.result as any).route).toBe("analysis");
    expect(analysis.verify).toHaveBeenCalledOnce();
    expect(igra.verify).not.toHaveBeenCalled();
  });

  it("routes IGRA verification without making IGRA a query dataset", async () => {
    const analysis = { verify: vi.fn(async () => ({ route: "analysis" })) };
    const igra = { verify: vi.fn(async (query) => ({ route: "igra", query })) };
    const service = new UnifiedForecastVerificationService(analysis as any, igra as any);

    const result = await service.verify({
      referenceDataset: "igra",
      geometry: point,
      time: { at: "2026-08-24T12:00:00Z" },
      leadHours: 48,
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850],
      gfsGrid: "0p25",
      stationId: "EZM00011520",
      maxStationDistanceKm: 100,
    });

    expect(result.datasets).toEqual(["gfs", "igra"]);
    expect((result.result as any).route).toBe("igra");
    expect(igra.verify).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2026-08-24T12:00:00Z",
      gfsGrid: "0p25",
      stationId: "EZM00011520",
      maxStationDistanceKm: 100,
    }));
    expect(analysis.verify).not.toHaveBeenCalled();
  });
});
