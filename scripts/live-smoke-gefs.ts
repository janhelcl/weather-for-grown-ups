import assert from "node:assert/strict";
import { GefsBatchPointsService } from "../src/core/gefs-batch-points.js";
import { GefsDiagnosticTimeSeriesService } from "../src/core/gefs-diagnostic-timeseries.js";
import { GefsEnsembleProfileService } from "../src/core/gefs-ensemble-profile.js";
import { GefsEnsembleTimeSeriesService } from "../src/core/gefs-ensemble-timeseries.js";
import { GefsEnsembleService } from "../src/core/gefs-ensemble.js";
import { GefsLatestRunResolver } from "../src/core/gefs-latest-run.js";
import { GefsLayerDiagnosticsService } from "../src/core/gefs-layer-diagnostics.js";
import { GefsProfileDiagnosticsService } from "../src/core/gefs-profile-diagnostics.js";
import { latestGefsCycleAtOrBefore } from "../src/core/gefs-time.js";
import { GfsGefsComparisonService } from "../src/core/gfs-gefs-comparison.js";

const members = ["c00", "p01", "p02"] as const;
const endTime = latestGefsCycleAtOrBefore(new Date());
const startTime = new Date(endTime.getTime() - 3 * 3_600_000);
const latestRunResolver = new GefsLatestRunResolver();
const run = await latestRunResolver.resolveLatestRunRange(startTime, endTime, members);
const ensembleService = new GefsEnsembleService({ latestRunProvider: latestRunResolver });
const batchPointsService = new GefsBatchPointsService({ latestRunProvider: latestRunResolver });
const profileService = new GefsEnsembleProfileService({ latestRunProvider: latestRunResolver });
const layerDiagnosticsService = new GefsLayerDiagnosticsService({ profileGetter: profileService });
const profileDiagnosticsService = new GefsProfileDiagnosticsService({ profileGetter: profileService });
const diagnosticTimeSeriesService = new GefsDiagnosticTimeSeriesService({
  layerDiagnosticsGetter: layerDiagnosticsService,
  profileDiagnosticsGetter: profileDiagnosticsService,
  latestRunRangeProvider: latestRunResolver,
});
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

const batchPoints = await batchPointsService.getPoints({
  points: [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 49.1951, longitude: 16.6068 },
    { latitude: 47.8095, longitude: 13.055 },
  ],
  run: run.toISOString(),
  validTime: endTime.toISOString(),
  variable: "temperature",
  pressureLevelHpa: 850,
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
  thresholdGte: 0,
});

assert.equal(batchPoints.model, "gefs_0p50");
assert.equal(batchPoints.run, result.run);
assert.equal(batchPoints.validTime, result.validTime);
assert.equal(batchPoints.forecastHour, result.forecastHour);
assert.deepEqual(batchPoints.selection.members, members);
assert.deepEqual(batchPoints.selection.quantiles, [0.1, 0.5, 0.9]);
assert.equal(batchPoints.points.length, 3);
assert(batchPoints.points.every((point) => point.members === undefined));
assert(batchPoints.points.every((point) => point.summary.memberCount === members.length));
assert(batchPoints.points.every((point) => Number.isFinite(point.summary.mean)));
assert(batchPoints.points.every((point) => Number.isFinite(point.summary.populationStdDev)));
assert(batchPoints.points.every((point) => point.summary.quantiles.length === 3));
assert(batchPoints.points.every((point) => point.summary.threshold?.interpretation === "raw_member_fraction_not_calibrated_probability"));
assert.equal(batchPoints.source.memberFiles.length, members.length);
assert.deepEqual(batchPoints.source.memberFiles.map((entry) => entry.member), members);
// The scalar ensemble query above fetched these exact member/run/field slices first.
// Multi-point access should therefore reuse all three cached slices and only resample them locally.
assert.equal(batchPoints.source.allCacheHit, true);
assert(batchPoints.source.memberFiles.every((entry) => entry.cacheHit));

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

const profileDiagnostics = await profileDiagnosticsService.getProfileDiagnostics({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  validTime: endTime.toISOString(),
  pressureLevelsHpa: [1000, 925, 850, 700, 500],
  diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
});

assert.equal(profileDiagnostics.model, "gefs_0p50");
assert.equal(profileDiagnostics.run, run.toISOString());
assert.equal(profileDiagnostics.validTime, endTime.toISOString());
assert.equal(profileDiagnostics.forecastHour, result.forecastHour);
assert.deepEqual(profileDiagnostics.sampledPressureLevelsHpa, [1000, 925, 850, 700, 500]);
assert.deepEqual(profileDiagnostics.selection.members, members);
assert.equal(profileDiagnostics.members, undefined);
assert.equal(profileDiagnostics.summaries.length, 2);
const freezingSummary = profileDiagnostics.summaries.find((summary) => summary.id === "freezing_level_crossings");
assert(freezingSummary?.id === "freezing_level_crossings");
assert.equal(freezingSummary.membersWithAnyCrossing.memberCount, members.length);
assert(freezingSummary.membersWithAnyCrossing.fraction >= 0 && freezingSummary.membersWithAnyCrossing.fraction <= 1);
assert.equal(freezingSummary.membersWithAnyCrossing.interpretation, "raw_member_fraction_not_calibrated_probability");
assert.equal(freezingSummary.crossingCount.memberCount, members.length);
assert.equal(freezingSummary.crossingCount.quantiles.length, 3);
if (freezingSummary.lowestCrossing) {
  assert(freezingSummary.lowestCrossing.contributingMemberCount > 0);
  assert(Number.isFinite(freezingSummary.lowestCrossing.geopotentialHeightGpm.mean));
  assert(Number.isFinite(freezingSummary.lowestCrossing.pressureHpa.mean));
}
const inversionSummary = profileDiagnostics.summaries.find((summary) => summary.id === "temperature_inversion_layers");
assert(inversionSummary?.id === "temperature_inversion_layers");
assert.equal(inversionSummary.membersWithAnyLayer.memberCount, members.length);
assert(inversionSummary.membersWithAnyLayer.fraction >= 0 && inversionSummary.membersWithAnyLayer.fraction <= 1);
assert.equal(inversionSummary.membersWithAnyLayer.interpretation, "raw_member_fraction_not_calibrated_probability");
assert.equal(inversionSummary.layerCount.memberCount, members.length);
assert.equal(inversionSummary.totalLayerDepthGpm.memberCount, members.length);
assert.equal(profileDiagnostics.source.provider, "NOAA AWS Open Data");
assert.equal(profileDiagnostics.source.access, "s3_range");
assert.equal(profileDiagnostics.source.product, "pgrb2a_0p50");

const diagnosticSeries = await diagnosticTimeSeriesService.getDiagnosticTimeSeries({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  startTime: startTime.toISOString(),
  endTime: endTime.toISOString(),
  diagnostic: {
    kind: "profile",
    pressureLevelsHpa: [1000, 925, 850, 700, 500],
    diagnostics: ["freezing_level_crossings"],
  },
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
  maxSteps: 2,
});

assert.equal(diagnosticSeries.model, "gefs_0p50");
assert.equal(diagnosticSeries.run, run.toISOString());
assert.equal(diagnosticSeries.startTime, startTime.toISOString());
assert.equal(diagnosticSeries.endTime, endTime.toISOString());
assert.equal(diagnosticSeries.stepHours, 3);
assert.equal(diagnosticSeries.series.length, 2);
assert.deepEqual(diagnosticSeries.series.map((step) => step.validTime), [startTime.toISOString(), endTime.toISOString()]);
assert(diagnosticSeries.series.every((step) => step.kind === "profile"));
for (const step of diagnosticSeries.series) {
  if (step.kind !== "profile") throw new Error("Expected live GEFS profile diagnostic time-series step");
  assert.equal(step.summaries.length, 1);
  const freezing = step.summaries[0];
  assert(freezing?.id === "freezing_level_crossings");
  assert.equal(freezing.membersWithAnyCrossing.memberCount, members.length);
  assert(freezing.membersWithAnyCrossing.fraction >= 0 && freezing.membersWithAnyCrossing.fraction <= 1);
  assert.equal(freezing.crossingCount.quantiles.length, 3);
}
assert.equal(diagnosticSeries.source.provider, "NOAA AWS Open Data");
assert.equal(diagnosticSeries.source.access, "s3_range");
assert.equal(diagnosticSeries.source.product, "pgrb2a_0p50");

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
  ensemblePoints: batchPoints.points.map((point) => ({
    requestedPoint: point.requestedPoint,
    gridPoint: point.gridPoint,
    meanC: point.summary.mean,
    populationStdDevC: point.summary.populationStdDev,
    quantiles: point.summary.quantiles,
    thresholdFractionGte0C: point.summary.threshold?.fraction,
  })),
  ensemblePointsMemberFiles: batchPoints.source.memberFiles,
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
  ensembleProfileDiagnostics: {
    sampledPressureLevelsHpa: profileDiagnostics.sampledPressureLevelsHpa,
    summaries: profileDiagnostics.summaries,
    cacheHit: profileDiagnostics.source.allCacheHit,
  },
  ensembleDiagnosticTimeSeries: diagnosticSeries.series.map((step) => ({
    validTime: step.validTime,
    forecastHour: step.forecastHour,
    kind: step.kind,
    summaries: step.kind === "profile" ? step.summaries : [],
    cacheHit: step.allCacheHit,
  })),
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
