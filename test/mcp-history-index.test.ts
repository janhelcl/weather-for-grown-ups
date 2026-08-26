import { describe, expect, it } from "vitest";
import {
  handleFindGfsHistoricalAnalogs,
  handleMaterializeGfsHistoryIndex,
} from "../src/mcp-history-tool.js";
import type {
  HistoricalAnalogResult,
  HistoricalIndexBuildResult,
} from "../src/schema/history-index.js";

const buildQuery = {
  latitude: 50.08,
  longitude: 14.43,
  startTime: "2017-05-09T00:00:00Z",
  endTime: "2017-05-10T23:59:59Z",
  cycleHoursUtc: [12] as const,
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
  maxSteps: 2,
};

const buildResult: HistoricalIndexBuildResult = {
  indexPath: "/tmp/wfg/profiles.jsonl",
  requestedStartTime: "2017-05-09T00:00:00.000Z",
  requestedEndTime: "2017-05-10T23:59:59.000Z",
  materialized: 2,
  totalMatchingRecords: 2,
  analysisTimes: ["2017-05-09T12:00:00.000Z", "2017-05-10T12:00:00.000Z"],
  note: "append-only local materialization; duplicate keys are deduplicated when read",
};

const analogQuery = {
  latitude: 50.08,
  longitude: 14.43,
  targetTime: "2017-05-09T12:00:00Z",
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850],
  count: 1,
  excludeWithinHours: 24,
  fetchTargetIfMissing: false,
};

const analogResult: HistoricalAnalogResult = {
  model: "gfs_grid4_analysis_0p5",
  targetTime: "2017-05-09T12:00:00.000Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
  indexPath: "/tmp/wfg/profiles.jsonl",
  metric: {
    name: "standardized_euclidean",
    features: ["850hPa.temperatureC"],
    windRepresentation: "u_v_components",
  },
  candidateCount: 1,
  target: {
    analysisTime: "2017-05-09T12:00:00.000Z",
    levels: [{ pressureHpa: 850, temperatureC: 10 }],
    dataset: "target.grb2",
    fromIndex: true,
  },
  analogs: [{
    rank: 1,
    analysisTime: "2017-05-01T12:00:00.000Z",
    distance: 0.2,
    levels: [{ pressureHpa: 850, temperatureC: 11 }],
    dataset: "analog.grb2",
  }],
  caveat: "Similarity is computed only from the selected GFS model-analysis variables and pressure levels; it is not a climatological or impact-specific similarity score",
};

describe("history index MCP handlers", () => {
  it("returns structured materialization output", async () => {
    const response = await handleMaterializeGfsHistoryIndex({ materialize: async () => buildResult }, buildQuery);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(buildResult) }],
      structuredContent: buildResult,
    });
  });

  it("returns structured analog output", async () => {
    const response = await handleFindGfsHistoricalAnalogs({ findAnalogs: async () => analogResult }, analogQuery);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(analogResult) }],
      structuredContent: analogResult,
    });
  });

  it("maps local index errors to MCP errors", async () => {
    const response = await handleFindGfsHistoricalAnalogs({
      findAnalogs: async () => { throw new Error("target not materialized"); },
    }, analogQuery);
    expect(response).toEqual({
      content: [{ type: "text", text: "target not materialized" }],
      isError: true,
    });
  });
});
