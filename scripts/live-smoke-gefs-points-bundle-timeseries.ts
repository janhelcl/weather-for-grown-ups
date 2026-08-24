import assert from "node:assert/strict";
import { GefsLatestRunResolver } from "../src/core/gefs-latest-run.js";
import { GefsPointsBundleTimeSeriesService } from "../src/core/gefs-points-bundle-timeseries.js";
import { latestGefsCycleAtOrBefore } from "../src/core/gefs-time.js";

const members = ["c00", "p01"] as const;
const points = [
  { latitude: 50.08, longitude: 14.43 },
  { latitude: 49.1951, longitude: 16.6068 },
] as const;
const endTime = latestGefsCycleAtOrBefore(new Date());
const startTime = new Date(endTime.getTime() - 3 * 3_600_000);
const run = await new GefsLatestRunResolver().resolveLatestRunRange(startTime, endTime, members);

const result = await new GefsPointsBundleTimeSeriesService().getPointsTimeSeries({
  points: [...points],
  run: run.toISOString(),
  startTime: startTime.toISOString(),
  endTime: endTime.toISOString(),
  selection: {
    variables: ["temperature", "dew_point"],
    pressureLevelsHpa: [850],
    fields: ["temperature_2m", "wind_10m"],
  },
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
  maxSteps: 2,
  maxPointSteps: 4,
});

assert.equal(result.model, "gefs_0p50");
assert.equal(result.run, run.toISOString());
assert.equal(result.startTime, startTime.toISOString());
assert.equal(result.endTime, endTime.toISOString());
assert.equal(result.stepHours, 3);
assert.equal(result.includeMembers, false);
assert.deepEqual(result.selection.members, members);
assert.deepEqual(result.selection.variables, ["temperature", "dew_point"]);
assert.deepEqual(result.selection.pressureLevelsHpa, [850]);
assert.deepEqual(result.selection.fields, ["temperature_2m", "wind_10m"]);
assert.equal(result.series.length, 2);
assert.deepEqual(result.series.map((step) => step.validTime), [startTime.toISOString(), endTime.toISOString()]);

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
    assert.equal(sampled.members, undefined);
    assert.equal(sampled.pressureSummaries.length, 2);
    assert.equal(sampled.fieldSummaries.length, 2);
    assert(sampled.pressureSummaries.every((summary) => summary.distribution.memberCount === members.length));
    assert(sampled.pressureSummaries.every((summary) => Number.isFinite(summary.distribution.mean)));
    assert(sampled.fieldSummaries.some((summary) => summary.field === "temperature_2m"));
    const wind = sampled.fieldSummaries.find((summary) => summary.field === "wind_10m");
    assert(wind);
    assert(wind.outputs.some((output) => output.aggregation === "circular_direction"));
  }
}

assert.equal(result.source.provider, "NOAA AWS Open Data");
assert.equal(result.source.access, "s3_range");
assert.equal(result.source.product, "pgrb2a_0p50");

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
      pressure: point.pressureSummaries.map((summary) => ({
        variable: summary.variable,
        pressureLevelHpa: summary.pressureLevelHpa,
        mean: summary.distribution.mean,
      })),
      fields: point.fieldSummaries.map((summary) => summary.field),
    })),
  })),
  allCacheHit: result.source.allCacheHit,
}, null, 2));
