import { describe, expect, it, vi } from "vitest";
import { handleGetGfsHistoricalAreaSummary } from "../src/mcp-history-area-tool.js";

describe("historical area MCP handler", () => {
  it("returns structured native-bbox area output and preserves errors", async () => {
    const summarize = vi.fn(async () => ({
      model: "gfs_grid4_analysis_0p5" as const,
      analysisTime: "2017-05-09T12:00:00.000Z",
      bbox: {
        westLongitude: 14,
        eastLongitude: 15,
        southLatitude: 50,
        northLatitude: 51,
      },
      variable: {
        id: "temperature" as const,
        pressureHpa: 850,
        field: "temperatureC",
        unit: "degC",
      },
      statistics: {
        definedGridPoints: 4,
        mean: 13,
        min: 10,
        max: 16,
        meanKind: "unweighted_grid_point_mean" as const,
      },
      source: {
        provider: "NOAA NCEI" as const,
        access: "ncei_thredds_ncss" as const,
        subset: "native_bbox_grid" as const,
        dataset: "archive.grb2",
        cacheHit: true,
      },
      caveat: "GFS model analysis area statistics; not direct observations or homogeneous climatological reanalysis" as const,
    }));

    const ok = await handleGetGfsHistoricalAreaSummary({ summarize } as never, {
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 50,
      northLatitude: 51,
      analysisTime: "2017-05-09T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
    });

    expect(ok.isError).toBeUndefined();
    expect(ok.structuredContent).toMatchObject({
      model: "gfs_grid4_analysis_0p5",
      statistics: { mean: 13 },
      source: { subset: "native_bbox_grid" },
    });

    const failure = await handleGetGfsHistoricalAreaSummary({
      summarize: vi.fn(async () => { throw new Error("archive unavailable"); }),
    } as never, {
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 50,
      northLatitude: 51,
      analysisTime: "2017-05-09T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    expect(failure).toMatchObject({
      isError: true,
      content: [{ text: "archive unavailable" }],
    });
  });
});
