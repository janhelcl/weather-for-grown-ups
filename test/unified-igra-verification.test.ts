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

  it("accepts bounded IGRA skill ranges and rejects oversized evaluation products", () => {
    const request = verifyAtmosphericForecastSchema.parse({
      referenceDataset: "igra",
      geometry: point,
      time: {
        from: "2026-08-01T00:00:00Z",
        to: "2026-08-10T12:00:00Z",
        hoursUtc: [0, 12],
        maxValidTimes: 8,
      },
      leadHours: [24, 48, 72],
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850, 700],
    });
    expect(request.time).toMatchObject({ maxValidTimes: 8 });
    expect(request.leadHours).toEqual([24, 48, 72]);

    expect(() => verifyAtmosphericForecastSchema.parse({
      referenceDataset: "igra",
      geometry: point,
      time: {
        from: "2026-08-01T00:00:00Z",
        to: "2026-08-10T12:00:00Z",
        maxValidTimes: 8,
      },
      leadHours: [24, 48, 72, 96],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).toThrow();
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

  it("routes IGRA time ranges to the skill aggregator", async () => {
    const analysis = { verify: vi.fn() };
    const igra = { verify: vi.fn() };
    const skill = { summarize: vi.fn(async (query) => ({ route: "skill", query })) };
    const service = new UnifiedForecastVerificationService(
      analysis as any,
      igra as any,
      skill as any,
    );

    const result = await service.verify({
      referenceDataset: "igra",
      geometry: point,
      time: {
        from: "2026-08-01T00:00:00Z",
        to: "2026-08-10T12:00:00Z",
        hoursUtc: [12],
        maxValidTimes: 4,
      },
      leadHours: [24, 48],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      stationId: "EZM00011520",
    });

    expect(result.datasets).toEqual(["gfs", "igra"]);
    expect((result.result as any).route).toBe("skill");
    expect(skill.summarize).toHaveBeenCalledWith(expect.objectContaining({
      startTime: "2026-08-01T00:00:00Z",
      endTime: "2026-08-10T12:00:00Z",
      cycleHoursUtc: [12],
      maxValidTimes: 4,
      leadHours: [24, 48],
      stationId: "EZM00011520",
    }));
    expect(analysis.verify).not.toHaveBeenCalled();
    expect(igra.verify).not.toHaveBeenCalled();
  });
});
