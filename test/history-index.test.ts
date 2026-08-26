import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoricalIndexService, buildFeatureSpec, standardizedDistance } from "../src/core/history-index.js";
import { HistoricalProfileIndexStore, canonicalSelection } from "../src/core/history-index-store.js";
import type { HistoricalProfileResult } from "../src/schema/history-result.js";
import type { HistoricalIndexRecord } from "../src/schema/history-index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), "wfg-history-index-"));
  tempDirs.push(dir);
  return new HistoricalProfileIndexStore({ path: join(dir, "profiles.jsonl") });
}

function record(
  analysisTime: string,
  temperatureC: number,
  options: { uWindMs?: number; vWindMs?: number; requestedLongitude?: number } = {},
): HistoricalIndexRecord {
  const level = {
    pressureHpa: 850,
    temperatureC,
    ...(options.uWindMs === undefined ? {} : { uWindMs: options.uWindMs }),
    ...(options.vWindMs === undefined ? {} : { vWindMs: options.vWindMs }),
  };
  return {
    version: 1,
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    requestedPoint: { latitude: 50.08, longitude: options.requestedLongitude ?? 14.43 },
    gridPoint: { latitude: 50, longitude: 14.5 },
    selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    levels: [level],
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: `archive/${analysisTime}.grb2`,
    },
  };
}

describe("HistoricalProfileIndexStore", () => {
  it("persists JSONL records and suppresses repeated semantic records", async () => {
    const store = await tempStore();
    const first = record("2017-05-09T12:00:00.000Z", 10);
    expect(await store.append([first])).toBe(1);
    expect(await store.append([first])).toBe(0);
    expect(await store.readAll()).toEqual([first]);
  });

  it("deduplicates semantically identical selections independent of ordering", () => {
    expect(canonicalSelection(["wind", "temperature"], [700, 850])).toBe(
      canonicalSelection(["temperature", "wind", "wind"], [850, 700, 850]),
    );
  });

  it("reports corrupt JSONL with a line number instead of silently skipping it", async () => {
    const store = await tempStore();
    await writeFile(store.path, '{"version":1}\nnot-json\n', "utf8");
    await expect(store.readAll()).rejects.toThrow(/profiles\.jsonl:1|profiles\.jsonl:2/);
  });
});

describe("HistoricalIndexService.materialize", () => {
  it("normalizes selection, appends profiles and reports matching index size", async () => {
    const store = await tempStore();
    const timeSeriesGetter = {
      getHistoricalTimeSeries: vi.fn(async () => ({
        model: "gfs_grid4_analysis_0p5" as const,
        requestedStartTime: "2017-05-09T00:00:00.000Z",
        requestedEndTime: "2017-05-10T23:59:59.000Z",
        requestedPoint: { latitude: 50.08, longitude: 14.43 },
        gridPoint: { latitude: 50, longitude: 14.5 },
        selection: {
          variables: ["temperature"] as const,
          pressureLevelsHpa: [850],
          cycleHoursUtc: [12],
        },
        source: { provider: "NOAA NCEI" as const, access: "ncei_thredds_ncss" as const },
        series: [
          {
            analysisTime: "2017-05-09T12:00:00.000Z",
            levels: [{ pressureHpa: 850, temperatureC: 10 }],
            dataset: "a.grb2",
            cacheHit: false,
          },
          {
            analysisTime: "2017-05-10T12:00:00.000Z",
            levels: [{ pressureHpa: 850, temperatureC: 12 }],
            dataset: "b.grb2",
            cacheHit: false,
          },
        ],
        caveat: "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
      })),
    };
    const service = new HistoricalIndexService({ store, timeSeriesGetter });
    const input = {
      latitude: 50.08,
      longitude: 14.43,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-10T23:59:59Z",
      cycleHoursUtc: [12] as const,
      variables: ["temperature"] as const,
      pressureLevelsHpa: [850],
      maxSteps: 2,
    };

    const first = await service.materialize(input);
    const second = await service.materialize(input);
    expect(first.materialized).toBe(2);
    expect(first.totalMatchingRecords).toBe(2);
    expect(second.materialized).toBe(0);
    expect(second.totalMatchingRecords).toBe(2);
    expect((await store.readAll()).map((item) => item.analysisTime)).toEqual([
      "2017-05-09T12:00:00.000Z",
      "2017-05-10T12:00:00.000Z",
    ]);
  });
});

describe("HistoricalIndexService.findAnalogs", () => {
  it("ranks local candidates by standardized model-state distance", async () => {
    const store = await tempStore();
    await store.append([
      record("2017-05-09T12:00:00.000Z", 10),
      record("2017-05-01T12:00:00.000Z", 11),
      record("2017-04-01T12:00:00.000Z", 20),
    ]);
    const service = new HistoricalIndexService({ store });
    const result = await service.findAnalogs({
      latitude: 50.08,
      longitude: 14.43,
      targetTime: "2017-05-09T12:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      count: 2,
      excludeWithinHours: 24,
      fetchTargetIfMissing: false,
    });

    expect(result.target.fromIndex).toBe(true);
    expect(result.candidateCount).toBe(2);
    expect(result.analogs.map((analog) => analog.analysisTime)).toEqual([
      "2017-05-01T12:00:00.000Z",
      "2017-04-01T12:00:00.000Z",
    ]);
    expect(result.analogs[0]!.distance).toBeLessThan(result.analogs[1]!.distance);
  });

  it("reuses a materialized target requested elsewhere inside the same Grid 4 cell", async () => {
    const store = await tempStore();
    await store.append([
      record("2017-05-09T12:00:00.000Z", 10, { requestedLongitude: 14.43 }),
      record("2017-05-01T12:00:00.000Z", 11),
    ]);
    const getHistoricalProfile = vi.fn();
    const service = new HistoricalIndexService({ store, profileGetter: { getHistoricalProfile } });
    const result = await service.findAnalogs({
      latitude: 50.12,
      longitude: 14.49,
      targetTime: "2017-05-09T12:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fetchTargetIfMissing: false,
    });

    expect(result.target.fromIndex).toBe(true);
    expect(result.gridPoint).toEqual({ latitude: 50, longitude: 14.5 });
    expect(getHistoricalProfile).not.toHaveBeenCalled();
  });

  it("can fetch and persist only the missing target before searching local candidates", async () => {
    const store = await tempStore();
    await store.append([
      record("2017-05-01T12:00:00.000Z", 11),
      record("2017-04-01T12:00:00.000Z", 20),
    ]);
    const profile: HistoricalProfileResult = {
      model: "gfs_grid4_analysis_0p5",
      analysisTime: "2017-05-09T12:00:00.000Z",
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      levels: [{ pressureHpa: 850, temperatureC: 10 }],
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        dataset: "target.grb2",
        cacheHit: false,
      },
      caveat: "GFS model analysis; not a direct observation or homogeneous climatological reanalysis",
    };
    const getHistoricalProfile = vi.fn(async () => profile);
    const service = new HistoricalIndexService({ store, profileGetter: { getHistoricalProfile } });
    const result = await service.findAnalogs({
      latitude: 50.08,
      longitude: 14.43,
      targetTime: "2017-05-09T12:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fetchTargetIfMissing: true,
    });

    expect(getHistoricalProfile).toHaveBeenCalledTimes(1);
    expect(result.target.fromIndex).toBe(false);
    expect((await store.readAll()).some((item) => item.analysisTime === profile.analysisTime)).toBe(true);
  });

  it("fails locally when the target is missing and fetching is disabled", async () => {
    const store = await tempStore();
    const service = new HistoricalIndexService({ store });
    await expect(service.findAnalogs({
      latitude: 50.08,
      longitude: 14.43,
      targetTime: "2017-05-09T12:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fetchTargetIfMissing: false,
    })).rejects.toThrow(/not materialized/);
  });
});

describe("historical analog metric", () => {
  it("represents wind with U/V components and never direction degrees", () => {
    const features = buildFeatureSpec(["wind", "u_wind"], [850]);
    expect(features.map((feature) => feature.name)).toEqual(["850hPa.uWindMs", "850hPa.vWindMs"]);
    expect(features.some((feature) => feature.name.includes("Direction"))).toBe(false);
  });

  it("computes Euclidean distance after per-feature scaling", () => {
    expect(standardizedDistance([0, 0], [2, 6], [2, 3])).toBeCloseTo(Math.sqrt(5));
  });
});
