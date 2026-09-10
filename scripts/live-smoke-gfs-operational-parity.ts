import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";

type Grid = "0p25" | "0p50";
type Source = "nomads" | "s3";

const HOUR_MS = 3_600_000;
const service = new UnifiedAtmosphereQueryService();
const run = candidateRun(3);
const runIso = run.toISOString();
const validTime = new Date(run.getTime() + 6 * HOUR_MS).toISOString();
const summaries = [];

for (const grid of ["0p25", "0p50"] as const) {
  const left = await profile(grid, "nomads");
  const right = await profile(grid, "s3");
  assert.equal(left.run, right.run);
  assert.equal(left.validTime, right.validTime);
  assert.deepEqual(left.gridPoint, right.gridPoint);
  compare(left.levels, right.levels, `${grid}.levels`);

  summaries.push({
    grid,
    run: runIso,
    validTime,
    leftSourceRequested: "nomads",
    rightSourceRequested: "s3",
    leftSource: left.source,
    rightSource: right.source,
  });
}

const autoWide = await wideAutomaticProfile();
assert.equal(autoWide.source.provider, "NOAA NOMADS");
assert.equal(autoWide.source.access, "nomads_grib_filter");
assert.equal(autoWide.source.decoder, "gribberish");
assert.equal(autoWide.levels.length, 16);
assert(autoWide.levels.every((level: any) => Number.isFinite(level.temperatureC)));
assert(autoWide.levels.every((level: any) => Number.isFinite(level.uWindMs)));

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  contract: "operational_nomads_vs_s3",
  summaries,
  automaticWidePoint: {
    run: autoWide.run,
    validTime: autoWide.validTime,
    pressureLevels: autoWide.levels.length,
    source: autoWide.source,
  },
}, null, 2));

async function profile(grid: Grid, source: Source): Promise<any> {
  const wrapped = await service.query({
    dataset: "gfs",
    geometry: { type: "point", latitude: 50, longitude: 14 },
    time: { at: validTime },
    selection: {
      variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
      pressureLevelsHpa: [925, 850, 700, 500],
    },
    forecast: { run: runIso, grid },
    source,
  });
  return wrapped.result as any;
}

async function wideAutomaticProfile(): Promise<any> {
  const wrapped = await service.query({
    dataset: "gfs",
    geometry: { type: "point", latitude: 45.765, longitude: 11.73 },
    time: { at: validTime },
    selection: {
      variables: ["temperature", "relative_humidity", "u_wind", "v_wind", "geopotential_height"],
      pressureLevelsHpa: [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350],
      fields: ["temperature_2m", "total_precipitation", "low_cloud_cover_average"],
    },
    forecast: { run: runIso, grid: "0p25" },
  });
  return wrapped.result as any;
}

function candidateRun(daysAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysAgo,
    0, 0, 0, 0,
  ));
}

function compare(left: any, right: any, path: string): void {
  if (typeof left === "number" || typeof right === "number") {
    assert.equal(typeof left, "number", `${path}: left is not numeric`);
    assert.equal(typeof right, "number", `${path}: right is not numeric`);
    const scale = Math.max(1, Math.abs(left), Math.abs(right));
    const tolerance = Math.max(2e-4, scale * 2e-7);
    assert(Math.abs(left - right) <= tolerance, `${path}: ${left} != ${right}`);
    return;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    assert(Array.isArray(left) && Array.isArray(right), `${path}: shape differs`);
    assert.equal(left.length, right.length, `${path}: length differs`);
    left.forEach((value, index) => compare(value, right[index], `${path}[${index}]`));
    return;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (["source", "model", "caveat", "dataset", "cacheHit"].includes(key)) continue;
      assert(key in left && key in right, `${path}.${key}: key missing`);
      compare(left[key], right[key], `${path}.${key}`);
    }
    return;
  }
  assert.deepEqual(left, right, `${path}: semantic value differs`);
}
