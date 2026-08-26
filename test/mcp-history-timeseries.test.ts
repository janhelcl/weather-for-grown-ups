import { describe, expect, it } from "vitest";
import { handleGetGfsHistoricalTimeSeries } from "../src/mcp-history-tool.js";
import type { HistoricalTimeSeriesResult } from "../src/schema/history-result.js";

const query = {
  latitude: 50.08,
  longitude: 14.43,
  startTime: "2017-05-09T00:00:00Z",
  endTime: "2017-05-10T23:59:59Z",
  cycleHoursUtc: [12] as const,
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
  maxSteps: 2,
};

const result: HistoricalTimeSeriesResult = {
  model: "gfs_grid4_analysis_0p5",
  requestedStartTime: "2017-05-09T00:00:00.000Z",
  requestedEndTime: "2017-05-10T23:59:59.000Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850],
    cycleHoursUtc: [12],
  },
  source: { provider: "NOAA NCEI", access: "ncei_thredds_ncss" },
  series: [
    {
      analysisTime: "2017-05-09T12:00:00.000Z",
      levels: [{ pressureHpa: 850, temperatureC: 12 }],
      dataset: "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2",
      cacheHit: false,
    },
    {
      analysisTime: "2017-05-10T12:00:00.000Z",
      levels: [{ pressureHpa: 850, temperatureC: 10 }],
      dataset: "model-gfs-g4-anl-files-old/201705/20170510/gfsanl_4_20170510_1200_000.grb2",
      cacheHit: true,
    },
  ],
  caveat: "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
};

describe("handleGetGfsHistoricalTimeSeries", () => {
  it("returns text and structured MCP output", async () => {
    const response = await handleGetGfsHistoricalTimeSeries({
      getHistoricalTimeSeries: async () => result,
    }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("maps service failures to MCP errors", async () => {
    const response = await handleGetGfsHistoricalTimeSeries({
      getHistoricalTimeSeries: async () => { throw new Error("historical range too large"); },
    }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: "historical range too large" }],
      isError: true,
    });
  });
});
