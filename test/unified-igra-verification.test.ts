import { describe, expect, it, vi } from "vitest";
import {
  GfsAnalysisVerificationAdapter,
  IgraVerificationAdapter,
} from "../src/core/specialized-adapters/verification.js";
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

  it("does not leak IGRA-specific controls into the analysis reference", () => {
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

describe("verification adapters", () => {
  it("maps atomic IGRA verification", async () => {
    const instant = { verify: vi.fn(async (query) => ({ route: "igra", query })) };
    const adapter = new IgraVerificationAdapter(instant as any, { summarize: vi.fn() } as any);
    const request = verifyAtmosphericForecastSchema.parse({
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
    const result = await adapter.verify(request);
    expect((result as any).route).toBe("igra");
    expect(instant.verify).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2026-08-24T12:00:00Z",
      gfsGrid: "0p25",
      stationId: "EZM00011520",
      maxStationDistanceKm: 100,
    }));
  });

  it("maps IGRA skill ranges", async () => {
    const skill = { summarize: vi.fn(async (query) => ({ route: "skill", query })) };
    const adapter = new IgraVerificationAdapter({ verify: vi.fn() } as any, skill as any);
    const request = verifyAtmosphericForecastSchema.parse({
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
    await adapter.verify(request);
    expect(skill.summarize).toHaveBeenCalledWith(expect.objectContaining({
      startTime: "2026-08-01T00:00:00Z",
      endTime: "2026-08-10T12:00:00Z",
      cycleHoursUtc: [12],
      maxValidTimes: 4,
      leadHours: [24, 48],
      stationId: "EZM00011520",
    }));
  });

  it("maps atomic analysis verification and guards reference ownership", async () => {
    const instant = { verify: vi.fn(async (query) => ({ route: "analysis", query })) };
    const analysis = new GfsAnalysisVerificationAdapter(
      instant as any,
      { summarize: vi.fn() } as any,
    );
    const analysisRequest = verifyAtmosphericForecastSchema.parse({
      referenceDataset: "gfs-analysis",
      geometry: point,
      time: { at: "2019-12-26T18:00:00Z" },
      leadHours: 54,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    await analysis.verify(analysisRequest);
    expect(instant.verify).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2019-12-26T18:00:00Z",
      leadHours: 54,
    }));

    const igraRequest = verifyAtmosphericForecastSchema.parse({
      referenceDataset: "igra",
      geometry: point,
      time: { at: "2026-08-24T12:00:00Z" },
      leadHours: 48,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    await expect(analysis.verify(igraRequest)).rejects.toThrow("referenceDataset=gfs-analysis");
    await expect(new IgraVerificationAdapter().verify(analysisRequest)).rejects.toThrow(
      "referenceDataset=igra",
    );
  });
});
