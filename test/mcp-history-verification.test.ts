import { describe, expect, it } from "vitest";
import { handleVerifyGfsHistoricalForecast } from "../src/mcp-history-tool.js";
import type { HistoricalForecastVerificationResult } from "../src/schema/history-verification-result.js";

const query = {
  latitude: 50.08,
  longitude: 14.43,
  validTime: "2017-05-09T12:00:00Z",
  leadHours: 48,
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
};

const result: HistoricalForecastVerificationResult = {
  model: "gfs_grid4_archive_verification_0p5",
  validTime: "2017-05-09T12:00:00.000Z",
  leadHours: 48,
  forecastRun: "2017-05-07T12:00:00.000Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
  comparison: "analysis_minus_forecast",
  forecast: {
    model: "gfs_grid4_forecast_0p5_archive",
    runTime: "2017-05-07T12:00:00.000Z",
    forecastHour: 48,
    validTime: "2017-05-09T12:00:00.000Z",
    levels: [{ pressureHpa: 850, temperatureC: 10 }],
    dataset: "model-gfs-004-files-old/201705/20170507/gfs_4_20170507_1200_048.grb2",
    cacheHit: false,
  },
  analysis: {
    model: "gfs_grid4_analysis_0p5",
    analysisTime: "2017-05-09T12:00:00.000Z",
    levels: [{ pressureHpa: 850, temperatureC: 12 }],
    dataset: "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2",
    cacheHit: true,
  },
  pressureLevels: [{
    pressureHpa: 850,
    changes: [{ field: "temperatureC", forecast: 10, analysis: 12, delta: 2, deltaKind: "linear" }],
  }],
  source: {
    provider: "NOAA NCEI",
    access: "ncei_thredds_ncss",
    forecastArchiveAvailability: "online availability varies; older forecast data may require NCEI HAS",
  },
  caveat: "Forecast verification against GFS model analysis, not direct observations; historical GFS model versions changed over time",
};

describe("handleVerifyGfsHistoricalForecast", () => {
  it("returns structured verification output", async () => {
    const response = await handleVerifyGfsHistoricalForecast({ verify: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("maps archive availability failures to MCP errors", async () => {
    const response = await handleVerifyGfsHistoricalForecast({
      verify: async () => { throw new Error("older forecast data may require NCEI HAS retrieval"); },
    }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: "older forecast data may require NCEI HAS retrieval" }],
      isError: true,
    });
  });
});
