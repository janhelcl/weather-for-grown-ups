import { describe, expect, it, vi } from "vitest";
import { handleGetGfsHistoricalFields } from "../src/mcp-history-fields-tool.js";

describe("historical mixed fields MCP handler", () => {
  it("returns structured content", async () => {
    const getHistoricalFields = vi.fn(async () => ({
      model: "gfs_grid4_analysis_0p5" as const,
      analysisTime: "2017-05-09T12:00:00.000Z",
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      selection: { fields: ["surface_pressure" as const] },
      fields: [{
        id: "surface_pressure" as const,
        level: { type: "surface" as const },
        temporal: { type: "instantaneous" as const },
        values: { pressurePa: 100100 },
      }],
      source: {
        provider: "NOAA NCEI" as const,
        access: "ncei_thredds_ncss" as const,
        dataset: "archive.grb2",
        cacheHit: true,
      },
      caveat: "GFS model analysis fields; not direct observations or homogeneous climatological reanalysis" as const,
    }));

    const result = await handleGetGfsHistoricalFields({ getHistoricalFields } as never, {
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      fields: ["surface_pressure"],
    });
    expect(result).toMatchObject({
      structuredContent: {
        model: "gfs_grid4_analysis_0p5",
        fields: [{ id: "surface_pressure", values: { pressurePa: 100100 } }],
      },
    });
  });

  it("returns service errors", async () => {
    const result = await handleGetGfsHistoricalFields({
      getHistoricalFields: vi.fn(async () => { throw new Error("field unavailable in archive era"); }),
    } as never, {
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      fields: ["surface_pressure"],
    });
    expect(result).toMatchObject({ isError: true, content: [{ text: "field unavailable in archive era" }] });
  });
});
