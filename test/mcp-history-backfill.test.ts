import { describe, expect, it } from "vitest";
import { handleBackfillGfsHistoryIndex } from "../src/mcp-history-tool.js";
import type { HistoricalIndexBackfillResult } from "../src/schema/history-index.js";

const query = {
  latitude: 50.08,
  longitude: 14.43,
  startTime: "2017-05-01T00:00:00Z",
  endTime: "2017-05-04T23:59:59Z",
  cycleHoursUtc: [12] as const,
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
  maxFetches: 2,
};

const result: HistoricalIndexBackfillResult = {
  model: "gfs_grid4_analysis_0p5",
  indexPath: "/tmp/profiles.jsonl",
  requestedStartTime: "2017-05-01T00:00:00.000Z",
  requestedEndTime: "2017-05-04T23:59:59.000Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850],
    cycleHoursUtc: [12],
    order: "oldest_first",
  },
  selectedCycleCount: 4,
  alreadyMaterialized: 1,
  fetchBudget: 2,
  attempted: 2,
  cacheHits: 1,
  upstreamFetches: 1,
  materialized: 2,
  analysisTimesMaterialized: ["2017-05-02T12:00:00.000Z", "2017-05-03T12:00:00.000Z"],
  failures: [],
  remaining: 1,
  nextAnalysisTime: "2017-05-04T12:00:00.000Z",
  status: "budget_exhausted",
  note: "resumable backfill skips materialized Grid 4 analyses before fetch; archive access remains serial and NOAA-paced",
};

describe("handleBackfillGfsHistoryIndex", () => {
  it("returns structured resumable progress", async () => {
    const response = await handleBackfillGfsHistoryIndex({ backfill: async () => result }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("maps validation failures to MCP errors", async () => {
    const response = await handleBackfillGfsHistoryIndex({
      backfill: async () => { throw new Error("Historical GFS backfill endTime must not be in the future"); },
    }, query);
    expect(response).toEqual({
      content: [{ type: "text", text: "Historical GFS backfill endTime must not be in the future" }],
      isError: true,
    });
  });
});
