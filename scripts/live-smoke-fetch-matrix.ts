import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileService } from "../src/core/profile.js";
import { BatchPointsService } from "../src/core/batch-points.js";
import { PointsTimeSeriesService } from "../src/core/points-time-series.js";
import { LatestRunResolver } from "../src/core/latest-run.js";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import { shutdownGribDecodePool } from "../src/grib/grib-decode-pool.js";
import type { ProfileLevel } from "../src/core/types.js";
import type { VariableId } from "../src/schema/query.js";

// Isolate cold/warm evidence from a developer's existing forecast cache. Each
// case runs twice; spatial expansions also assert reuse of earlier selections.
const cacheDir = await mkdtemp(join(tmpdir(), "wfg-fetch-matrix-"));
const previousCacheDir = process.env.WFG_CACHE_DIR;
process.env.WFG_CACHE_DIR = cacheDir;
const originalFetch = globalThis.fetch;
type Traffic = { requests: number; ranges: number; bodyBytes: number; statuses: Record<string, number> };
const emptyTraffic = (): Traffic => ({ requests: 0, ranges: 0, bodyBytes: 0, statuses: {} });
let traffic = emptyTraffic();
globalThis.fetch = async (input, init) => {
  const current = traffic;
  current.requests += 1;
  if (new Headers(init?.headers).has("range")) current.ranges += 1;
  const response = await originalFetch(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
  });
  current.statuses[response.status] = (current.statuses[response.status] ?? 0) + 1;
  const readBytes = response.arrayBuffer.bind(response);
  const readText = response.text.bind(response);
  response.arrayBuffer = async () => {
    const bytes = await readBytes();
    current.bodyBytes += bytes.byteLength;
    return bytes;
  };
  response.text = async () => {
    const text = await readText();
    current.bodyBytes += Buffer.byteLength(text);
    return text;
  };
  return response;
};

const rows: Array<Traffic & { id: string; pass: string; ms: number; ok: boolean; error?: string }> = [];
try {
  const run = await new LatestRunResolver().resolveLatestRun();
  const at = (hour: number) => new Date(run.getTime() + hour * 3_600_000).toISOString();
  const points = [
    { latitude: 50.08, longitude: 14.43 }, // Prague
    { latitude: -33.87, longitude: 151.21 }, // Sydney
    { latitude: 0, longitude: -179.9 }, // both sides of the dateline
    { latitude: 0, longitude: 179.9 },
    { latitude: 89.9, longitude: 0 }, // polar grid edge
  ];
  const narrow = { variables: ["temperature"] satisfies VariableId[], pressureLevelsHpa: [850] };
  const profile = {
    variables: ["temperature", "relative_humidity", "u_wind", "v_wind"] satisfies VariableId[],
    pressureLevelsHpa: [850, 700, 500],
  };
  const wide = { ...profile, pressureLevelsHpa: [1000, 925, 850, 700, 600, 500, 400, 300, 200] };
  const base = { ...points[0]!, run: run.toISOString(), validTime: at(6), source: "s3" as const };
  const profiles = new ProfileService();
  const batches = new BatchPointsService({ profileGetter: profiles });
  const matrices = new PointsTimeSeriesService({ batchPointsGetter: batches });
  const unified = new UnifiedAtmosphereQueryService();
  let scalar: number | undefined;

  function checkLevels(levels: ProfileLevel[], selection: { variables: VariableId[]; pressureLevelsHpa: number[] }): void {
    assert.deepEqual(levels.map((level) => level.pressureHpa), selection.pressureLevelsHpa);
    for (const level of levels) {
      assert(Number.isFinite(level.temperatureC));
      if (selection.variables.includes("relative_humidity")) {
        assert(Number.isFinite(level.relativeHumidityPct));
        assert(Number.isFinite(level.uWindMs));
        assert(Number.isFinite(level.vWindMs));
      }
    }
  }

  const cases: Array<{ id: string; reuse?: boolean; run: () => Promise<void> }> = [
    { id: "point / 1 hour / 1 message", run: async () => {
      const result = await profiles.getProfile({ ...base, ...narrow });
      checkLevels(result.levels, narrow);
      assert.equal(result.run, run.toISOString());
      assert.equal(result.source.access, "s3_range");
      scalar = result.levels[0]!.temperatureC;
    } },
    { id: "5 global points / 1 hour / 1 message", reuse: true, run: async () => {
      const result = await batches.getPoints({ ...base, points, ...narrow });
      assert.equal(result.points.length, points.length);
      result.points.forEach((point) => checkLevels(point.levels, narrow));
      assert.equal(result.points[0]!.levels[0]!.temperatureC, scalar);
    } },
    { id: "point / 1 hour / 12 messages", run: async () => {
      const result = await profiles.getProfile({ ...base, ...profile });
      checkLevels(result.levels, profile);
      assert.equal(result.levels[0]!.temperatureC, scalar);
    } },
    { id: "5 global points / 1 hour / 12 messages", reuse: true, run: async () => {
      const result = await batches.getPoints({ ...base, points, ...profile });
      assert.equal(result.points.length, points.length);
      result.points.forEach((point) => checkLevels(point.levels, profile));
    } },
    ...[
      { hours: [7, 8, 9], selection: profile },
      { hours: [240, 243, 246], selection: narrow },
    ].map(({ hours, selection }) => ({
      id: `5 global points / f${hours.join(",")} / ${selection.variables.length * selection.pressureLevelsHpa.length} messages per step`,
      run: async () => {
        const result = await matrices.getPointsTimeSeries({
          run: run.toISOString(), points, ...selection,
          startTime: at(hours[0]!), endTime: at(hours.at(-1)!),
        });
        assert.deepEqual(result.series.map((step) => step.forecastHour), hours);
        for (const step of result.series) {
          assert.equal(step.points.length, points.length);
          step.points.forEach((point) => checkLevels(point.levels, selection));
        }
      },
    })),
    { id: "point / 1 hour / 36 messages", run: async () => {
      const result = await profiles.getProfile({ ...base, ...wide });
      checkLevels(result.levels, wide);
    } },
    { id: "0.5 degree grid / point / 12 messages", run: async () => {
      const result = await profiles.getProfile({ ...base, ...profile, grid: "0p50" });
      checkLevels(result.levels, profile);
      assert.equal(result.model, "gfs_0p50");
    } },
    ...[1, 10].map((size) => ({
      id: `area / ${size} degree box / temperature_2m`,
      run: async () => {
        const result = await unified.query({
          dataset: "gfs", forecast: { run: run.toISOString() }, time: { at: at(6) },
          geometry: {
            type: "area", westLongitude: 14, eastLongitude: 14 + size,
            southLatitude: 45, northLatitude: 45 + size,
          },
          selection: { fields: ["temperature_2m"] },
          aggregate: { percentiles: [10, 50, 90] },
        });
        assert.equal(result.dataset, "gfs");
        assert.equal(result.geometryType, "area");
        assertFiniteDistributions(result.result);
      },
    })),
    ...(["gefs", "aigefs"] as const).map((dataset) => ({
      id: `${dataset} / 2 members / pressure and surface fields`,
      run: async () => {
        const result = await unified.query({
          dataset, forecast: { run: run.toISOString() }, time: { at: at(6) },
          geometry: { type: "point", ...points[0]! },
          selection: { variables: ["temperature"], pressureLevelsHpa: [850, 500], fields: ["temperature_2m"] },
          ensemble: { members: ["c00", "p01"], quantiles: [0.5] },
        });
        assert.equal(result.dataset, dataset);
        assertFiniteDistributions(result.result);
      },
    })),
    { id: "2017 reforecast / 2 members / 3 steps across archive blocks", run: async () => {
      const result = await unified.query({
        dataset: "gefs", geometry: { type: "point", ...points[0]! },
        forecast: { kind: "reforecast", run: "2017-03-14T00:00:00Z" },
        time: { from: "2017-03-23T21:00:00Z", to: "2017-03-24T06:00:00Z", maxSteps: 3 },
        selection: { fields: ["temperature_2m"] },
        ensemble: { members: ["c00", "p01"], quantiles: [0.5] },
      });
      assert.equal(result.internalDatasetId, "gefs_v12_reforecast");
      assert.equal(result.timeType, "range");
      const series = (result.result as { series: Array<{ forecastHour: number }> }).series;
      assert.deepEqual(series.map((step) => step.forecastHour), [237, 240, 246]);
      assertFiniteDistributions(result.result);
    } },
  ];
  console.error(`Pinned GFS run ${run.toISOString()}; isolated cache ${cacheDir}`);
  for (const item of cases) {
    for (const pass of ["first", "repeat"]) {
      traffic = emptyTraffic();
      const started = performance.now();
      let error: string | undefined;
      try {
        await item.run();
        if (pass === "repeat" || item.reuse) assert.equal(traffic.requests, 0, "cached query made an HTTP request");
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
        process.exitCode = 1;
      }
      const row = { id: item.id, pass, ms: Math.round(performance.now() - started), ...traffic, ok: error === undefined, ...(error === undefined ? {} : { error }) };
      rows.push(row);
      console.error(`${row.ok ? "PASS" : "FAIL"} ${pass} ${row.ms}ms ${row.requests} HTTP ${(row.bodyBytes / 1_048_576).toFixed(2)} MiB: ${item.id}${error ? `: ${error}` : ""}`);
    }
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), run: run.toISOString(), rows }, null, 2));
} finally {
  shutdownGribDecodePool();
  globalThis.fetch = originalFetch;
  if (previousCacheDir === undefined) delete process.env.WFG_CACHE_DIR;
  else process.env.WFG_CACHE_DIR = previousCacheDir;
  await rm(cacheDir, { recursive: true, force: true });
}

function assertFiniteDistributions(value: unknown): void {
  let means = 0;
  function visit(item: unknown): void {
    if (item === null || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (key === "mean") { assert(Number.isFinite(child)); means += 1; }
      else visit(child);
    }
  }
  visit(value);
  assert(means > 0, "result contained no numeric distributions");
}
