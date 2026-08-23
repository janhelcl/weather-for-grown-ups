import assert from "node:assert/strict";
import { GefsEnsembleTimeSeriesService } from "../src/core/gefs-ensemble-timeseries.js";
import { GefsEnsembleService } from "../src/core/gefs-ensemble.js";
import { GefsLatestRunResolver } from "../src/core/gefs-latest-run.js";
import { latestGefsCycleAtOrBefore } from "../src/core/gefs-time.js";
import { GfsGefsComparisonService } from "../src/core/gfs-gefs-comparison.js";

const members = ["c00", "p01", "p02"] as const;
const endTime = latestGefsCycleAtOrBefore(new Date());
const startTime = new Date(endTime.getTime() - 3 * 3_600_000);
const latestRunResolver = new GefsLatestRunResolver();
const run = await latestRunResolver.resolveLatestRunRange(startTime, endTime, members);
const ensembleService = new GefsEnsembleService({ latestRunProvider: latestRunResolver });
const timeSeriesService = new GefsEnsembleTimeSeriesService({
  ensembleGetter: ensembleService,
  latestRunRangeProvider: latestRunResolver,
});
const comparisonService = new GfsGefsComparisonService({ ensembleGetter: ensembleService });

const result = await ensembleService.getEnsemble({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  validTime: endTime.toISOString(),
  variable: "temperature",
  pressureLevelHpa: 850,
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
  thresholdGte: 0,
});

assert.equal(result.model, "gefs_0p50");
assert.equal(result.run, run.toISOString());
assert.equal(result.validTime, endTime.toISOString());
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

const series = await timeSeriesService.getTimeSeries({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  startTime: startTime.toISOString(),
  endTime: endTime.toISOString(),
  variable: "temperature",
  pressureLevelHpa: 850,
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
  thresholdGte: 0,
});

assert.equal(series.model, "gefs_0p50");
assert.equal(series.run, run.toISOString());
assert.equal(series.startTime, startTime.toISOString());
assert.equal(series.endTime, endTime.toISOString());
assert.equal(series.stepHours, 3);
assert.equal(series.includeMembers, false);
assert.equal(series.series.length, 2);
assert.deepEqual(series.series.map((step) => step.validTime), [startTime.toISOString(), endTime.toISOString()]);
assert(series.series.every((step) => step.members === undefined));
assert(series.series.every((step) => Number.isFinite(step.summary.mean)));
assert(series.series.every((step) => Number.isFinite(step.summary.populationStdDev)));
assert(series.series.every((step) => step.summary.threshold?.interpretation === "raw_member_fraction_not_calibrated_probability"));
assert.equal(series.source.provider, "NOAA AWS Open Data");
assert.equal(series.source.access, "s3_range");
assert.equal(series.source.product, "pgrb2a_0p50");

const comparison = await comparisonService.compare({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  validTime: endTime.toISOString(),
  variable: "temperature",
  pressureLevelHpa: 850,
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
});

assert.equal(comparison.run, run.toISOString());
assert.equal(comparison.validTime, endTime.toISOString());
assert.equal(comparison.forecastHour, result.forecastHour);
assert.equal(comparison.deterministicGfs.model, "gfs_0p25");
assert.equal(comparison.gefs.model, "gefs_0p50");
assert(Number.isFinite(comparison.deterministicGfs.value));
assert(Number.isFinite(comparison.comparison.deterministicMinusEnsembleMean));
assert(
  comparison.comparison.standardizedDifference === null ||
  Number.isFinite(comparison.comparison.standardizedDifference),
);
assert.equal(comparison.gefs.summary.memberCount, members.length);
assert.equal(
  comparison.comparison.interpretation,
  "raw_model_vs_raw_ensemble_distribution_not_calibrated_uncertainty",
);

console.log(JSON.stringify({
  run: result.run,
  pointEnsemble: {
    validTime: result.validTime,
    forecastHour: result.forecastHour,
    members: result.members.map((sample) => ({ member: sample.member, temperatureC: sample.value })),
    meanC: result.summary.mean,
    populationStdDevC: result.summary.populationStdDev,
    quantiles: result.summary.quantiles,
    cacheHit: result.source.allCacheHit,
  },
  ensembleTimeSeries: series.series.map((step) => ({
    validTime: step.validTime,
    forecastHour: step.forecastHour,
    meanC: step.summary.mean,
    populationStdDevC: step.summary.populationStdDev,
    quantiles: step.summary.quantiles,
    thresholdFractionGte0C: step.summary.threshold?.fraction,
  })),
  gfsVsGefs: {
    deterministicGfsTemperatureC: comparison.deterministicGfs.value,
    gefsMeanC: comparison.gefs.summary.mean,
    gefsPopulationStdDevC: comparison.gefs.summary.populationStdDev,
    standardizedDifference: comparison.comparison.standardizedDifference,
    rangePosition: comparison.comparison.rangePosition,
    fractionMembersAtOrBelowDeterministic: comparison.comparison.fractionMembersAtOrBelowDeterministic,
  },
  seriesCacheHit: series.source.allCacheHit,
}, null, 2));
