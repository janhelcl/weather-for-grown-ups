import assert from "node:assert/strict";
import { GefsEnsembleProfileService } from "../src/core/gefs-ensemble-profile.js";
import { GefsEnsembleTimeSeriesService } from "../src/core/gefs-ensemble-timeseries.js";
import { GefsEnsembleService } from "../src/core/gefs-ensemble.js";
import { GefsLatestRunResolver } from "../src/core/gefs-latest-run.js";
import { GefsLayerDiagnosticsService } from "../src/core/gefs-layer-diagnostics.js";
import { latestGefsCycleAtOrBefore } from "../src/core/gefs-time.js";
import { GfsGefsComparisonService } from "../src/core/gfs-gefs-comparison.js";

const members = ["c00", "p01", "p02"] as const;
const endTime = latestGefsCycleAtOrBefore(new Date());
const startTime = new Date(endTime.getTime() - 3 * 3_600_000);
const latestRunResolver = new GefsLatestRunResolver();
const run = await latestRunResolver.resolveLatestRunRange(startTime, endTime, members);
const ensembleService = new GefsEnsembleService({ latestRunProvider: latestRunResolver });
const profileService = new GefsEnsembleProfileService({ latestRunProvider: latestRunResolver });
const layerDiagnosticsService = new GefsLayerDiagnosticsService({ profileGetter: profileService });
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

const profile = await profileService.getProfile({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  validTime: endTime.toISOString(),
  variables: ["temperature", "geopotential_height"],
  pressureLevelsHpa: [850, 500],
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
});

assert.equal(profile.model, "gefs_0p50");
assert.equal(profile.run, run.toISOString());
assert.equal(profile.validTime, endTime.toISOString());
assert.equal(profile.forecastHour, result.forecastHour);
assert.deepEqual(profile.selection.members, members);
assert.deepEqual(profile.selection.pressureLevelsHpa, [850, 500]);
assert.equal(profile.summaries.length, 4);
assert.equal(profile.members, undefined);
assert(profile.summaries.every((summary) => summary.memberCount === members.length));
assert(profile.summaries.every((summary) => Number.isFinite(summary.mean)));
assert(profile.summaries.every((summary) => Number.isFinite(summary.populationStdDev)));
assert(profile.summaries.every((summary) => summary.quantiles.length === 3));
assert.equal(profile.source.provider, "NOAA AWS Open Data");
assert.equal(profile.source.access, "s3_range");
assert.equal(profile.source.product, "pgrb2a_0p50");

const layerDiagnostics = await layerDiagnosticsService.getLayerDiagnostics({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  validTime: endTime.toISOString(),
  lowerPressureHpa: 850,
  upperPressureHpa: 500,
  diagnostics: ["temperature_lapse_rate"],
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
});

assert.equal(layerDiagnostics.model, "gefs_0p50");
assert.equal(layerDiagnostics.run, run.toISOString());
assert.equal(layerDiagnostics.validTime, endTime.toISOString());
assert.equal(layerDiagnostics.forecastHour, result.forecastHour);
assert.deepEqual(layerDiagnostics.selection.members, members);
assert.deepEqual(layerDiagnostics.selection.diagnostics, ["temperature_lapse_rate"]);
assert.equal(layerDiagnostics.members, undefined);
assert.equal(layerDiagnostics.layerDepthGpm.memberCount, members.length);
assert(layerDiagnostics.layerDepthGpm.mean > 0);
assert(Number.isFinite(layerDiagnostics.layerDepthGpm.populationStdDev));
assert.equal(layerDiagnostics.layerDepthGpm.quantiles.length, 3);
assert.equal(layerDiagnostics.summaries.length, 1);
const liveLapseRate = layerDiagnostics.summaries[0];
assert(liveLapseRate);
assert.equal(liveLapseRate.id, "temperature_lapse_rate");
assert.equal(liveLapseRate.field, "temperatureLapseRateCPerKm");
assert.equal(liveLapseRate.unit, "degC/km");
assert.equal(liveLapseRate.distribution.memberCount, members.length);
assert(Number.isFinite(liveLapseRate.distribution.mean));
assert(Number.isFinite(liveLapseRate.distribution.populationStdDev));
assert.equal(liveLapseRate.distribution.quantiles.length, 3);
assert.equal(layerDiagnostics.source.provider, "NOAA AWS Open Data");
assert.equal(layerDiagnostics.source.access, "s3_range");
assert.equal(layerDiagnostics.source.product, "pgrb2a_0p50");

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
  ensembleProfile: profile.summaries.map((summary) => ({
    variable: summary.variable,
    pressureLevelHpa: summary.pressureLevelHpa,
    unit: summary.unit,
    mean: summary.mean,
    populationStdDev: summary.populationStdDev,
    quantiles: summary.quantiles,
  })),
  ensembleLayerDiagnostics: {
    pressureLayer: layerDiagnostics.pressureLayer,
    layerDepthGpm: layerDiagnostics.layerDepthGpm,
    summaries: layerDiagnostics.summaries,
    cacheHit: layerDiagnostics.source.allCacheHit,
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
  profileCacheHit: profile.source.allCacheHit,
  seriesCacheHit: series.source.allCacheHit,
}, null, 2));
