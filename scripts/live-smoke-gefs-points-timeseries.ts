import assert from "node:assert/strict";
import { GefsLatestRunResolver } from "../src/core/gefs-latest-run.js";
import { GefsPointsTimeSeriesService } from "../src/core/gefs-points-timeseries.js";
import { latestGefsCycleAtOrBefore } from "../src/core/gefs-time.js";

const members = ["c00", "p01"] as const;
const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.1951, longitude: 16.6068 },
] as const;
const endTime = latestGefsCycleAtOrBefore(new Date());
const startTime = new Date(endTime.getTime() - 3 * 3_600_000);
const latestRunResolver = new GefsLatestRunResolver();
const run = await latestRunResolver.resolveLatestRunRange(startTime, endTime, members);
const service = new GefsPointsTimeSeriesService();

const result = await service.getPointsTimeSeries({
  points: [...points],
  run: run.toISOString(),
  startTime: startTime.toISOString(),
  endTime: endTime.toISOString(),
  variable: "temperature",
  pressureLevelHpa: 850,
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
  thresholdGte: 0,
  maxSteps: 2,
  maxSamples: 4,
});

assert.equal(result.model, "gefs_0p50");
assert.equal(result.run, run.toISOString());
assert.equal(result.startTime, startTime.toISOString());
assert.equal(result.endTime, endTime.toISOString());
assert.equal(result.stepHours, 3);
assert.equal(result.includeMembers, false);
assert.deepEqual(result.selection.members, members);
assert.deepEqual(result.selection.quantiles, [0.1, 0.5, 0.9]);
assert.equal(result.series.length, 2);
assert.deepEqual(result.series.map((step) => step.validTime), [startTime.toISOString(), endTime.toISOString()]);
assert(result.series.every((step) => step.points.length === points.length));
assert(result.series.every((step) => step.points.every((point) => point.members === undefined)));
assert(result.series.every((step) => step.points.every((point) => point.summary.memberCount === members.length)));
assert(result.series.every((step) => step.points.every((point) => Number.isFinite(point.summary.mean))));
assert(result.series.every((step) => step.points.every((point) => Number.isFinite(point.summary.populationStdDev))));
assert(result.series.every((step) => step.points.every((point) => point.summary.quantiles.length === 3)));
assert(result.series.every((step) => step.points.every((point) =>
  point.summary.threshold?.interpretation === "raw_member_fraction_not_calibrated_probability"
)));
assert.equal(result.source.provider, "NOAA AWS Open Data");
assert.equal(result.source.access, "s3_range");
assert.equal(result.source.product, "pgrb2a_0p50");

for (const pointIndex of points.keys()) {
  const requested = points[pointIndex];
  const first = result.series[0]?.points[pointIndex];
  assert(first);
  assert.deepEqual(first.requestedPoint, requested);
  for (const step of result.series) {
    const sampled = step.points[pointIndex];
    assert(sampled);
    assert.deepEqual(sampled.requestedPoint, requested);
    assert.deepEqual(sampled.gridPoint, first.gridPoint);
  }
}

console.log(JSON.stringify({
  run: result.run,
  startTime: result.startTime,
  endTime: result.endTime,
  members: result.selection.members,
  steps: result.series.map((step) => ({
    validTime: step.validTime,
    forecastHour: step.forecastHour,
    allCacheHit: step.allCacheHit,
    points: step.points.map((point) => ({
      requestedPoint: point.requestedPoint,
      gridPoint: point.gridPoint,
      meanC: point.summary.mean,
      populationStdDevC: point.summary.populationStdDev,
      quantiles: point.summary.quantiles,
      thresholdFractionGte0C: point.summary.threshold?.fraction,
    })),
  })),
  allCacheHit: result.source.allCacheHit,
}, null, 2));
