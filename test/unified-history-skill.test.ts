import { describe, expect, it, vi } from "vitest";
import { GfsAnalysisVerificationAdapter } from "../src/core/specialized-adapters/verification.js";
import { verifyAtmosphericForecastSchema } from "../src/schema/unified-specialized.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

describe("unified GFS-analysis skill verification", () => {
  it("accepts bounded range verification with historical variables", () => {
    const request = verifyAtmosphericForecastSchema.parse({
      referenceDataset: "gfs-analysis",
      geometry: point,
      time: {
        from: "2019-12-20T00:00:00Z",
        to: "2019-12-26T18:00:00Z",
        hoursUtc: [0, 12],
        maxValidTimes: 4,
      },
      leadHours: [24, 48],
      variables: ["temperature", "vertical_velocity"],
      pressureLevelsHpa: [850, 500],
    });
    expect(request.referenceDataset).toBe("gfs-analysis");
    expect(request.leadHours).toEqual([24, 48]);
  });

  it("rejects IGRA-only controls on GFS-analysis skill ranges", () => {
    expect(() => verifyAtmosphericForecastSchema.parse({
      referenceDataset: "gfs-analysis",
      geometry: point,
      time: { from: "2019-12-20T00:00:00Z", to: "2019-12-26T18:00:00Z" },
      leadHours: [24],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      gfsGrid: "0p25",
    })).toThrow(/only valid when referenceDataset=igra/);
  });

  it("maps analysis ranges to the analysis skill service", async () => {
    const skill = { summarize: vi.fn(async (query) => ({ route: "analysis-skill", query })) };
    const adapter = new GfsAnalysisVerificationAdapter(
      { verify: vi.fn() } as any,
      skill as any,
    );
    const request = verifyAtmosphericForecastSchema.parse({
      referenceDataset: "gfs-analysis",
      geometry: point,
      time: {
        from: "2019-12-20T00:00:00Z",
        to: "2019-12-26T18:00:00Z",
        hoursUtc: [12],
        maxValidTimes: 4,
      },
      leadHours: [24, 48],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    const result = await adapter.verify(request);
    expect((result as any).route).toBe("analysis-skill");
    expect(skill.summarize).toHaveBeenCalledWith(expect.objectContaining({
      startTime: "2019-12-20T00:00:00Z",
      endTime: "2019-12-26T18:00:00Z",
      cycleHoursUtc: [12],
      maxValidTimes: 4,
      leadHours: [24, 48],
    }));
  });
});
