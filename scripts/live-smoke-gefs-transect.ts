import assert from "node:assert/strict";
import { GefsLatestRunResolver } from "../src/core/gefs-latest-run.js";
import { GefsTransectService } from "../src/core/gefs-transect.js";
import { latestGefsCycleAtOrBefore } from "../src/core/gefs-time.js";

const members = ["c00", "p01"] as const;
const validTime = latestGefsCycleAtOrBefore(new Date());
const run = await new GefsLatestRunResolver().resolveLatestRunRange(validTime, validTime, members);

const result = await new GefsTransectService().getTransect({
  start: { latitude: 50.08, longitude: 14.43 },
  end: { latitude: 49.20, longitude: 16.61 },
  run: run.toISOString(),
  validTime: validTime.toISOString(),
  selection: {
    variables: ["temperature", "dew_point"],
    pressureLevelsHpa: [850],
    fields: ["temperature_2m", "wind_10m"],
  },
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
  samples: 3,
});

assert.equal(result.model, "gefs_0p50");
assert.equal(result.run, run.toISOString());
assert.equal(result.validTime, validTime.toISOString());
assert.equal(result.samples.length, 3);
assert.equal(result.includeMembers, false);
assert.deepEqual(result.selection.members, members);
assert.deepEqual(result.selection.variables, ["temperature", "dew_point"]);
assert.deepEqual(result.selection.pressureLevelsHpa, [850]);
assert.deepEqual(result.selection.fields, ["temperature_2m", "wind_10m"]);
assert.deepEqual(result.samples[0]?.requestedPoint, { latitude: 50.08, longitude: 14.43 });
assert.deepEqual(result.samples[2]?.requestedPoint, { latitude: 49.20, longitude: 16.61 });
assert.equal(result.samples[0]?.fraction, 0);
assert.equal(result.samples[2]?.fraction, 1);
assert.equal(result.samples[0]?.distanceKm, 0);
assert(Math.abs((result.samples[2]?.distanceKm ?? 0) - result.totalDistanceKm) < 1e-9);

for (const sample of result.samples) {
  assert.equal(sample.members, undefined);
  assert.equal(sample.pressureSummaries.length, 2);
  assert.equal(sample.fieldSummaries.length, 2);
  assert(sample.pressureSummaries.every((summary) => summary.distribution.memberCount === members.length));
  assert(sample.pressureSummaries.every((summary) => Number.isFinite(summary.distribution.mean)));
  assert(sample.fieldSummaries.some((summary) => summary.field === "temperature_2m"));
  const wind = sample.fieldSummaries.find((summary) => summary.field === "wind_10m");
  assert(wind);
  assert(wind.outputs.some((output) => output.aggregation === "circular_direction"));
}

assert.equal(result.source.provider, "NOAA AWS Open Data");
assert.equal(result.source.access, "s3_range");
assert.equal(result.source.product, "pgrb2a_0p50");
assert.equal(result.source.memberFiles.length, members.length);

console.log(JSON.stringify({
  run: result.run,
  validTime: result.validTime,
  forecastHour: result.forecastHour,
  members: result.selection.members,
  totalDistanceKm: result.totalDistanceKm,
  samples: result.samples.map((sample) => ({
    index: sample.index,
    fraction: sample.fraction,
    distanceKm: sample.distanceKm,
    requestedPoint: sample.requestedPoint,
    gridPoint: sample.gridPoint,
    pressure: sample.pressureSummaries.map((summary) => ({
      variable: summary.variable,
      pressureLevelHpa: summary.pressureLevelHpa,
      mean: summary.distribution.mean,
    })),
    fields: sample.fieldSummaries.map((summary) => summary.field),
  })),
  allCacheHit: result.source.allCacheHit,
}, null, 2));
