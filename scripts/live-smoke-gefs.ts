import assert from "node:assert/strict";
import { GefsEnsembleService } from "../src/core/gefs-ensemble.js";
import { GefsLatestRunResolver } from "../src/core/gefs-latest-run.js";
import { latestGefsCycleAtOrBefore } from "../src/core/gefs-time.js";

const members = ["c00", "p01", "p02"] as const;
const validTime = latestGefsCycleAtOrBefore(new Date());
const latestRunResolver = new GefsLatestRunResolver();
const run = await latestRunResolver.resolveLatestRun(validTime, members);
const service = new GefsEnsembleService({ latestRunProvider: latestRunResolver });

const result = await service.getEnsemble({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  validTime: validTime.toISOString(),
  variable: "temperature",
  pressureLevelHpa: 850,
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
  thresholdGte: 0,
});

assert.equal(result.model, "gefs_0p50");
assert.equal(result.run, run.toISOString());
assert.equal(result.validTime, validTime.toISOString());
assert.equal(result.members.length, members.length);
assert.deepEqual(result.members.map((sample) => sample.member), members);
assert(result.members.every((sample) => Number.isFinite(sample.value)));
assert(Number.isFinite(result.summary.mean));
assert(Number.isFinite(result.summary.populationStdDev));
assert.equal(result.summary.quantiles.length, 3);
assert(result.summary.threshold);
assert.equal(result.summary.threshold.interpretation, "raw_member_fraction_not_calibrated_probability");
assert.equal(result.source.provider, "NOAA AWS Open Data");
assert.equal(result.source.access, "s3_range");
assert.equal(result.source.product, "pgrb2a_0p50");

console.log(JSON.stringify({
  run: result.run,
  validTime: result.validTime,
  forecastHour: result.forecastHour,
  members: result.members.map((sample) => ({ member: sample.member, temperatureC: sample.value })),
  meanC: result.summary.mean,
  populationStdDevC: result.summary.populationStdDev,
  quantiles: result.summary.quantiles,
  cacheHit: result.source.allCacheHit,
}, null, 2));
