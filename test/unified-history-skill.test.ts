import { describe, expect, it, vi } from "vitest";
import { UnifiedForecastVerificationService } from "../src/core/unified-specialized-api.js";
import { verifyAtmosphericForecastSchema } from "../src/schema/unified-specialized.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

describe("unified GFS-analysis skill verification", () => {
  it("accepts bounded range verification with historical variables", () => {
    const request = verifyAtmosphericForecastSchema.parse({
      referenceDataset: "gfs-analysis",
      geometry: point,
      time: { from: "2019-12-20T00:00:00Z", to: "2019-12-26T18:00:00Z", hoursUtc: [0, 12], maxValidTimes: 4 },
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

  it("routes analysis ranges to the analysis skill service", async () => {
    const analysis = { verify: vi.fn() };
    const igra = { verify: vi.fn() };
    const igraSkill = { summarize: vi.fn() };
    const analysisSkill = { summarize: vi.fn(async (query) => ({ route: "analysis-skill", query })) };
    const service = new UnifiedForecastVerificationService(
      analysis as any, igra as any, igraSkill as any, analysisSkill as any,
    );

    const result = await service.verify({
      referenceDataset: "gfs-analysis",
      geometry: point,
      time: { from: "2019-12-20T00:00:00Z", to: "2019-12-26T18:00:00Z", hoursUtc: [12], maxValidTimes: 4 },
      leadHours: [24, 48],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });

    expect(result.datasets).toEqual(["gfs", "gfs-analysis"]);
    expect((result.result as any).route).toBe("analysis-skill");
    expect(analysisSkill.summarize).toHaveBeenCalledWith(expect.objectContaining({
      startTime: "2019-12-20T00:00:00Z",
      endTime: "2019-12-26T18:00:00Z",
      cycleHoursUtc: [12],
      maxValidTimes: 4,
      leadHours: [24, 48],
    }));
    expect(analysis.verify).not.toHaveBeenCalled();
    expect(igra.verify).not.toHaveBeenCalled();
    expect(igraSkill.summarize).not.toHaveBeenCalled();
  });
});
