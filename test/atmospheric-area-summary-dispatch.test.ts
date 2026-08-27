import { describe, expect, it, vi } from "vitest";
import { AtmosphericAreaSummaryService } from "../src/core/atmospheric-area-summary-service.js";

describe("atmospheric area summary dispatch", () => {
  it("routes deterministic GFS, GEFS, and historical analysis without flattening schemas", async () => {
    const gfsResult = { model: "gfs_0p25" as const };
    const gefsResult = { model: "gefs_0p50" as const };
    const historyResult = { model: "gfs_grid4_analysis_0p5" as const };

    const gfs = { summarize: vi.fn(async () => gfsResult) };
    const gefs = { summarize: vi.fn(async () => gefsResult) };
    const history = { summarize: vi.fn(async () => historyResult) };
    const service = new AtmosphericAreaSummaryService({
      gfs: gfs as never,
      gefs: gefs as never,
      history: history as never,
    });

    expect((await service.summarize({
      model: "gfs_0p25",
      query: {} as never,
    })).model).toBe("gfs_0p25");
    expect((await service.summarize({
      model: "gefs_0p50",
      query: {} as never,
    })).model).toBe("gefs_0p50");
    const historical = await service.summarize({
      model: "gfs_grid4_analysis_0p5",
      query: {} as never,
    });
    expect(historical.model).toBe("gfs_grid4_analysis_0p5");
    expect("run" in historical).toBe(false);

    expect(gfs.summarize).toHaveBeenCalledOnce();
    expect(gefs.summarize).toHaveBeenCalledOnce();
    expect(history.summarize).toHaveBeenCalledOnce();
  });
});
