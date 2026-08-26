import { describe, expect, it, vi } from "vitest";
import {
  handleGetGfsHistoricalFields,
  handleGetGfsHistoricalFieldsTimeSeries,
} from "../src/mcp-history-fields-tool.js";

const caveat = "GFS model analysis fields; not direct observations or homogeneous climatological reanalysis" as const;

function historicalFieldStep(analysisTime: string) {
  return {
    model: "gfs_grid4_analysis_0p5" as const,
    analysisTime,
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
    caveat,
  };
}

describe("historical mixed fields MCP handler", () => {
  it("returns structured content", async () => {
    const getHistoricalFields = vi.fn(async () => historicalFieldStep("2017-05-09T12:00:00.000Z"));

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

  it("returns structured time-series content", async () => {
    const getHistoricalFieldsTimeSeries = vi.fn(async () => ({
      model: "gfs_grid4_analysis_0p5" as const,
      requestedStartTime: "2017-05-09T00:00:00.000Z",
      requestedEndTime: "2017-05-10T23:59:59.000Z",
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      selection: {
        fields: ["surface_pressure" as const],
        cycleHoursUtc: [12 as const],
      },
      source: { provider: "NOAA NCEI" as const, access: "ncei_thredds_ncss" as const },
      series: [
        {
          analysisTime: "2017-05-09T12:00:00.000Z",
          fields: historicalFieldStep("2017-05-09T12:00:00.000Z").fields,
          dataset: "20170509.grb2",
          cacheHit: true,
        },
        {
          analysisTime: "2017-05-10T12:00:00.000Z",
          fields: historicalFieldStep("2017-05-10T12:00:00.000Z").fields,
          dataset: "20170510.grb2",
          cacheHit: false,
        },
      ],
      caveat,
    }));

    const result = await handleGetGfsHistoricalFieldsTimeSeries(
      { getHistoricalFieldsTimeSeries } as never,
      {
        latitude: 50.08,
        longitude: 14.43,
        startTime: "2017-05-09T00:00:00Z",
        endTime: "2017-05-10T23:59:59Z",
        fields: ["surface_pressure"],
        cycleHoursUtc: [12],
        maxSteps: 2,
      },
    );

    expect(result).toMatchObject({
      structuredContent: {
        selection: { cycleHoursUtc: [12] },
        series: [
          { analysisTime: "2017-05-09T12:00:00.000Z" },
          { analysisTime: "2017-05-10T12:00:00.000Z" },
        ],
      },
    });
  });
});
