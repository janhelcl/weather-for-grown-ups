import { describe, expect, it, vi } from "vitest";
import {
  HistoricalTimeSeriesService,
  historicalAnalysisTimesInRange,
  type HistoricalProfileGetter,
} from "../src/core/history-time-series.js";
import type { HistoricalProfileQueryInput } from "../src/schema/history.js";
import type { HistoricalProfileResult } from "../src/schema/history-result.js";

function profileFor(input: HistoricalProfileQueryInput): HistoricalProfileResult {
  const analysisTime = new Date(String(input.analysisTime)).toISOString();
  const date = analysisTime.slice(0, 10).replaceAll("-", "");
  const hour = analysisTime.slice(11, 13);
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: { latitude: Number(input.latitude), longitude: Number(input.longitude) },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: {
      variables: [...(input.variables ?? [])],
      pressureLevelsHpa: [...(input.pressureLevelsHpa ?? [])],
    },
    levels: (input.pressureLevelsHpa ?? []).map((pressureHpa) => ({
      pressureHpa,
      temperatureC: pressureHpa === 850 ? 12 : 2,
    })),
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: `model-gfs-g4-anl-files-old/${date}/gfsanl_4_${date}_${hour}00_000.grb2`,
      cacheHit: false,
    },
    caveat: "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
  };
}

function mockProfileGetter(): HistoricalProfileGetter {
  return {
    getHistoricalProfile: vi.fn(async (input) => profileFor(input)),
  };
}

describe("historicalAnalysisTimesInRange", () => {
  it("selects only requested UTC cycles inside an inclusive range", () => {
    expect(historicalAnalysisTimesInRange(
      new Date("2017-05-09T07:00:00Z"),
      new Date("2017-05-11T12:00:00Z"),
      [12],
    ).map((date) => date.toISOString())).toEqual([
      "2017-05-09T12:00:00.000Z",
      "2017-05-10T12:00:00.000Z",
      "2017-05-11T12:00:00.000Z",
    ]);
  });

  it("preserves all native six-hour analyses when every cycle is selected", () => {
    expect(historicalAnalysisTimesInRange(
      new Date("2017-05-09T00:00:00Z"),
      new Date("2017-05-09T18:00:00Z"),
      [0, 6, 12, 18],
    )).toHaveLength(4);
  });
});

describe("HistoricalTimeSeriesService", () => {
  it("composes sparse daily historical profiles with per-step provenance", async () => {
    const profileGetter = mockProfileGetter();
    const service = new HistoricalTimeSeriesService({
      profileGetter,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });

    const result = await service.getHistoricalTimeSeries({
      latitude: 50.08,
      longitude: 14.43,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-11T23:59:59Z",
      cycleHoursUtc: [12],
      variables: ["temperature"],
      pressureLevelsHpa: [850, 700],
      maxSteps: 3,
    });

    expect(result.selection.cycleHoursUtc).toEqual([12]);
    expect(result.series.map((step) => step.analysisTime)).toEqual([
      "2017-05-09T12:00:00.000Z",
      "2017-05-10T12:00:00.000Z",
      "2017-05-11T12:00:00.000Z",
    ]);
    expect(result.series.every((step) => step.dataset.endsWith("_000.grb2"))).toBe(true);
    expect(profileGetter.getHistoricalProfile).toHaveBeenCalledTimes(3);
  });

  it("rejects oversized archive scans before fetching any profile", async () => {
    const profileGetter = mockProfileGetter();
    const service = new HistoricalTimeSeriesService({ profileGetter });

    await expect(service.getHistoricalTimeSeries({
      latitude: 50,
      longitude: 14,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-11T00:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxSteps: 4,
    })).rejects.toThrow(/exceeding maxSteps=4/);

    expect(profileGetter.getHistoricalProfile).not.toHaveBeenCalled();
  });

  it("fails when the selected cycles do not intersect the requested range", async () => {
    const service = new HistoricalTimeSeriesService({ profileGetter: mockProfileGetter() });
    await expect(service.getHistoricalTimeSeries({
      latitude: 50,
      longitude: 14,
      startTime: "2017-05-09T13:00:00Z",
      endTime: "2017-05-09T17:00:00Z",
      cycleHoursUtc: [12],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).rejects.toThrow(/contains no selected GFS analysis cycles/);
  });
});
