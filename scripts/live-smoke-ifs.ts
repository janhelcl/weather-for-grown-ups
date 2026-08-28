import assert from "node:assert/strict";
import { IfsAreaSummaryService } from "../src/core/ifs-area-summary.js";
import { IfsEnsAreaSummaryService } from "../src/core/ifs-ens-area-summary.js";
import { GfsIfsComparisonService } from "../src/core/gfs-ifs-comparison.js";
import { IfsEnsDiagnosticTimeSeriesService } from "../src/core/ifs-ens-diagnostic-timeseries.js";
import { IfsEnsDiagnosticsService } from "../src/core/ifs-ens-diagnostics.js";
import { IfsEnsMemberBundleService } from "../src/core/ifs-ens-member-bundle.js";
import {
  IfsEnsPointsService,
  IfsEnsPointsTimeSeriesService,
} from "../src/core/ifs-ens-points.js";
import { IfsEnsRunComparisonService } from "../src/core/ifs-ens-run-comparison.js";
import { IfsEnsTimeSeriesService } from "../src/core/ifs-ens-timeseries.js";
import { IfsEnsTransectService } from "../src/core/ifs-ens-transect.js";
import { IfsProfileService } from "../src/core/ifs-profile.js";
import { IfsDiagnosticsService } from "../src/core/ifs-diagnostics.js";
import { IfsRunComparisonService } from "../src/core/ifs-run-comparison.js";
import { IfsDiagnosticTimeSeriesService } from "../src/core/ifs-diagnostic-timeseries.js";
import {
  IfsPointsService,
  IfsPointsTimeSeriesService,
  IfsTimeSeriesService,
  IfsTransectService,
} from "../src/core/ifs-spatiotemporal.js";
import {
  ifsEnsValidTimeForForecastHour,
  ifsValidTimeForForecastHour,
  latestIfsCycleAtOrBefore,
  previousIfsCycle,
} from "../src/core/ifs-time.js";

const validTime = latestIfsCycleAtOrBefore(new Date());
const service = new IfsProfileService();

const result = await service.getProfile({
  latitude: 50.08,
  longitude: 14.43,
  run: "latest",
  validTime: validTime.toISOString(),
  variables: [
    "temperature",
    "relative_humidity",
    "u_wind",
    "v_wind",
    "geopotential_height",
    "absolute_vorticity",
    "divergence",
    "wind",
    "dew_point",
  ],
  pressureLevelsHpa: [850, 500],
  fields: [
    "surface_geopotential_height",
    "temperature_2m",
    "dew_point_2m",
    "relative_humidity_2m",
    "specific_humidity_2m",
    "wind_10m",
    "wind_100m",
    "total_precipitation",
    "precipitable_water",
    "total_atmosphere_cloud_cover",
  ],
});

assert.equal(result.model, "ifs_0p25");
assert.equal(result.validTime, validTime.toISOString());
assert.equal(result.levels.length, 2);
assert(result.levels.every((level) => Number.isFinite(level.temperatureC)));
assert(result.levels.every((level) => Number.isFinite(level.relativeHumidityPct)));
assert(result.levels.every((level) => Number.isFinite(level.windSpeedMs)));
assert(result.levels.every((level) => Number.isFinite(level.geopotentialHeightGpm)));
assert(result.levels.every((level) => Number.isFinite(level.absoluteVorticityS1)));
assert(result.levels.every((level) => Number.isFinite(level.divergenceS1)));
assert(result.fields?.some((field) =>
  field.id === "surface_geopotential_height" && Number.isFinite(field.values.geopotentialHeightGpm)));
assert(result.fields?.some((field) => field.id === "temperature_2m"));
assert(result.fields?.some((field) =>
  field.id === "relative_humidity_2m" && Number.isFinite(field.values.relativeHumidityPct)));
assert(result.fields?.some((field) =>
  field.id === "specific_humidity_2m" && Number.isFinite(field.values.specificHumidityKgKg)));
assert(result.fields?.some((field) => field.id === "wind_10m"));
assert(result.fields?.some((field) => field.id === "wind_100m"));
assert(result.fields?.some((field) => field.id === "precipitable_water"));
assert.equal(result.source.provider, "ECMWF Open Data");
assert.equal(result.source.access, "indexed_http_range");
assert.equal(result.source.product, "ifs_0p25_oper_fc");
assert.equal(result.source.horizontalGridDegrees, 0.25);

console.log(JSON.stringify({
  run: result.run,
  validTime: result.validTime,
  forecastHour: result.forecastHour,
  gridPoint: result.gridPoint,
  levels: result.levels,
  fields: result.fields,
  source: result.source,
}, null, 2));

const ens = await new IfsEnsMemberBundleService().getBundle({
  latitude: 50.08,
  longitude: 14.43,
  run: "latest",
  validTime: validTime.toISOString(),
  selection: {
    variables: ["temperature", "wind"],
    pressureLevelsHpa: [850],
    fields: ["wind_10m"],
  },
  members: ["p01", "p02"],
  quantiles: [0.1, 0.5, 0.9],
  includeMembers: true,
});
assert.equal(ens.model, "ifs_ens_0p25");
assert.equal(ens.selection.members.length, 2);
assert.equal(ens.pressureSummaries.length, 2);
assert(ens.pressureSummaries.every((summary) =>
  summary.outputs.every((output) =>
    output.aggregation === "circular_direction"
      ? Number.isFinite(output.meanDirectionDeg)
      : Number.isFinite(output.distribution.mean))));
assert.equal(ens.fieldSummaries.length, 1);
assert.equal(ens.members?.length, 2);
assert.equal(ens.source.product, "ifs_0p25_enfo_ef");
assert.equal(ens.source.memberSemantics, "50_perturbed_members_control_is_oper_fc");

console.log(JSON.stringify({
  ifsEns: {
    run: ens.run,
    validTime: ens.validTime,
    forecastHour: ens.forecastHour,
    members: ens.selection.members,
    pressureSummaries: ens.pressureSummaries,
    fieldSummaries: ens.fieldSummaries,
    source: ens.source,
  },
}, null, 2));

let longEnsRun = latestIfsCycleAtOrBefore(new Date(Date.now() - 12 * 3_600_000));
if (![0, 12].includes(longEnsRun.getUTCHours())) {
  longEnsRun = previousIfsCycle(longEnsRun);
}
const longEnsValidTime = ifsEnsValidTimeForForecastHour(longEnsRun, 300);
const longEns = await new IfsEnsMemberBundleService().getBundle({
  latitude: 50.08,
  longitude: 14.43,
  run: longEnsRun.toISOString(),
  validTime: longEnsValidTime.toISOString(),
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850],
  },
  members: ["p01", "p02"],
  quantiles: [0.5],
});
assert.equal(longEns.forecastHour, 300);
assert.equal(longEns.pressureSummaries.length, 1);
assert(Number.isFinite(
  longEns.pressureSummaries[0]?.outputs.find((output) => output.aggregation === "numeric_distribution")
    ?.distribution.mean,
));
assert.equal(longEns.source.product, "ifs_0p25_enfo_ef");

console.log(JSON.stringify({
  ifsEnsLongRange: {
    run: longEns.run,
    validTime: longEns.validTime,
    forecastHour: longEns.forecastHour,
    members: longEns.selection.members,
  },
}, null, 2));

const ensRun = new Date(ens.run);
const ensTimeSeries = await new IfsEnsTimeSeriesService().getTimeSeries({
  latitude: 50.08,
  longitude: 14.43,
  run: ens.run,
  startTime: ensRun.toISOString(),
  endTime: new Date(ensRun.getTime() + 3 * 3_600_000).toISOString(),
  selection: {
    variables: ["temperature", "wind"],
    pressureLevelsHpa: [850],
    fields: ["wind_10m"],
  },
  members: ["p01", "p02"],
  quantiles: [0.1, 0.5, 0.9],
});
assert.equal(ensTimeSeries.model, "ifs_ens_0p25");
assert.equal(ensTimeSeries.run, ens.run);
assert.deepEqual(ensTimeSeries.series.map((step) => step.forecastHour), [0, 3]);
assert(ensTimeSeries.series.every((step) => step.pressureSummaries.length === 2));
assert(ensTimeSeries.series.every((step) => step.fieldSummaries.length === 1));
assert.equal(ensTimeSeries.source.product, "ifs_0p25_enfo_ef");

console.log(JSON.stringify({
  ifsEnsTimeSeries: {
    run: ensTimeSeries.run,
    forecastHours: ensTimeSeries.series.map((step) => step.forecastHour),
    members: ensTimeSeries.selection.members,
    source: ensTimeSeries.source,
  },
}, null, 2));

const ensPoints = await new IfsEnsPointsService().getPoints({
  points: [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 49.82, longitude: 14.21 },
  ],
  run: ens.run,
  validTime: ens.validTime,
  selection: {
    variables: ["temperature", "wind"],
    pressureLevelsHpa: [850],
    fields: ["wind_10m"],
  },
  members: ["p01", "p02"],
  quantiles: [0.1, 0.5, 0.9],
});
assert.equal(ensPoints.model, "ifs_ens_0p25");
assert.equal(ensPoints.points.length, 2);
assert(ensPoints.points.every((point) => point.pressureSummaries.length === 2));
assert(ensPoints.points.every((point) => point.fieldSummaries.length === 1));
assert.equal(ensPoints.source.product, "ifs_0p25_enfo_ef");

const ensPointsTimeSeries = await new IfsEnsPointsTimeSeriesService().getPointsTimeSeries({
  points: [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 49.82, longitude: 14.21 },
  ],
  run: ens.run,
  startTime: ensRun.toISOString(),
  endTime: new Date(ensRun.getTime() + 3 * 3_600_000).toISOString(),
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850],
  },
  members: ["p01", "p02"],
  quantiles: [0.1, 0.5, 0.9],
  maxPointSteps: 4,
});
assert.deepEqual(ensPointsTimeSeries.series.map((step) => step.forecastHour), [0, 3]);
assert(ensPointsTimeSeries.series.every((step) => step.points.length === 2));
assert.equal(ensPointsTimeSeries.source.product, "ifs_0p25_enfo_ef");

console.log(JSON.stringify({
  ifsEnsMultiPoint: {
    run: ensPoints.run,
    validTime: ensPoints.validTime,
    pointCount: ensPoints.points.length,
    timeSeriesForecastHours: ensPointsTimeSeries.series.map((step) => step.forecastHour),
    cadence: ensPointsTimeSeries.cadence,
  },
}, null, 2));

const ensTransect = await new IfsEnsTransectService().getTransect({
  start: { latitude: 49.8, longitude: 14.0 },
  end: { latitude: 50.3, longitude: 15.0 },
  run: ens.run,
  validTime: ens.validTime,
  selection: {
    variables: ["temperature", "wind"],
    pressureLevelsHpa: [850],
    fields: ["wind_10m"],
  },
  members: ["p01", "p02"],
  quantiles: [0.1, 0.5, 0.9],
  samples: 3,
});
assert.equal(ensTransect.model, "ifs_ens_0p25");
assert.equal(ensTransect.samples.length, 3);
assert.equal(ensTransect.samples[0]?.fraction, 0);
assert.equal(ensTransect.samples[2]?.fraction, 1);
assert(ensTransect.samples.every((sample) => sample.pressureSummaries.length === 2));
assert(ensTransect.totalDistanceKm > 0);
assert.equal(ensTransect.source.product, "ifs_0p25_enfo_ef");

console.log(JSON.stringify({
  ifsEnsTransect: {
    run: ensTransect.run,
    validTime: ensTransect.validTime,
    samples: ensTransect.samples.length,
    totalDistanceKm: ensTransect.totalDistanceKm,
  },
}, null, 2));


const ensDiagnostics = new IfsEnsDiagnosticsService();
const ensLayerDiagnostics = await ensDiagnostics.getLayerDiagnostics({
  latitude: 50.08,
  longitude: 14.43,
  run: ens.run,
  validTime: ens.validTime,
  lowerPressureHpa: 850,
  upperPressureHpa: 500,
  diagnostics: ["temperature_lapse_rate", "wind_shear"],
  members: ["p01", "p02"],
  quantiles: [0.1, 0.5, 0.9],
});
assert.equal(ensLayerDiagnostics.model, "ifs_ens_0p25");
assert.equal(ensLayerDiagnostics.selection.members.length, 2);
assert(ensLayerDiagnostics.summaries.length >= 2);
assert(ensLayerDiagnostics.summaries.every((summary) =>
  Number.isFinite(summary.distribution.mean)));

const ensParcelDiagnostics = await ensDiagnostics.getParcelDiagnostics({
  latitude: 50.08,
  longitude: 14.43,
  run: ens.run,
  validTime: ens.validTime,
  pressureLevelsHpa: [925, 850, 700, 600, 500, 400, 300],
  parcel: "surface_2m",
  members: ["p01", "p02"],
  quantiles: [0.1, 0.5, 0.9],
});
assert.equal(ensParcelDiagnostics.model, "ifs_ens_0p25");
assert.equal(ensParcelDiagnostics.summary.capeJkg.memberCount, 2);
assert(Number.isFinite(ensParcelDiagnostics.summary.capeJkg.mean));
assert(Number.isFinite(ensParcelDiagnostics.summary.cinJkg.mean));
assert.equal(ensParcelDiagnostics.source.product, "ifs_0p25_enfo_ef");

console.log(JSON.stringify({
  ifsEnsDiagnostics: {
    run: ensLayerDiagnostics.run,
    validTime: ensLayerDiagnostics.validTime,
    layer: ensLayerDiagnostics.summaries.map((summary) => ({
      id: summary.id,
      field: summary.field,
      mean: summary.distribution.mean,
    })),
    parcel: {
      capeMeanJkg: ensParcelDiagnostics.summary.capeJkg.mean,
      cinMeanJkg: ensParcelDiagnostics.summary.cinJkg.mean,
      positiveCapeMemberFraction: ensParcelDiagnostics.summary.membersWithPositiveCape.fraction,
    },
  },
}, null, 2));

const ensDiagnosticTimeSeries = await new IfsEnsDiagnosticTimeSeriesService().getDiagnosticTimeSeries({
  latitude: 50.08,
  longitude: 14.43,
  run: ens.run,
  startTime: new Date(ens.run).toISOString(),
  endTime: new Date(new Date(ens.run).getTime() + 3 * 3_600_000).toISOString(),
  diagnostic: {
    kind: "layer",
    lowerPressureHpa: 850,
    upperPressureHpa: 500,
    diagnostics: ["temperature_lapse_rate"],
  },
  members: ["p01", "p02"],
  quantiles: [0.1, 0.5, 0.9],
});
assert.deepEqual(ensDiagnosticTimeSeries.series.map((step) => step.forecastHour), [0, 3]);
assert(ensDiagnosticTimeSeries.series.every((step) => step.kind === "layer"));
assert(ensDiagnosticTimeSeries.series.every((step) =>
  step.kind === "layer" && Number.isFinite(step.summaries[0]?.distribution.mean)));
assert.equal(ensDiagnosticTimeSeries.source.product, "ifs_0p25_enfo_ef");

console.log(JSON.stringify({
  ifsEnsDiagnosticTimeSeries: {
    run: ensDiagnosticTimeSeries.run,
    forecastHours: ensDiagnosticTimeSeries.series.map((step) => step.forecastHour),
    cadence: ensDiagnosticTimeSeries.cadence,
  },
}, null, 2));

const ensAreaSummary = await new IfsEnsAreaSummaryService().summarize({
  westLongitude: 14.0,
  eastLongitude: 14.25,
  southLatitude: 49.9,
  northLatitude: 50.1,
  run: ens.run,
  validTime: ens.validTime,
  variable: "temperature",
  pressureLevelHpa: 850,
  members: ["p01", "p02"],
  quantiles: [0.1, 0.5, 0.9],
  percentiles: [50],
  thresholds: [{ operator: "gte", value: 0 }],
  includeExtremaLocations: true,
  maxGridPoints: 100,
  maxMemberGridPoints: 200,
});
assert.equal(ensAreaSummary.model, "ifs_ens_0p25");
assert.equal(ensAreaSummary.statistics.mean.memberCount, 2);
assert(Number.isFinite(ensAreaSummary.statistics.mean.mean));
assert(Number.isFinite(ensAreaSummary.spatialPercentiles?.[0]?.distribution.mean));
assert(Number.isFinite(ensAreaSummary.spatialThresholdFractions?.[0]?.distribution.mean));
assert.equal(
  ensAreaSummary.methodology,
  "spatial_statistics_per_member_then_ensemble_distribution",
);
assert.equal(ensAreaSummary.source.product, "ifs_0p25_enfo_ef");

console.log(JSON.stringify({
  ifsEnsArea: {
    run: ensAreaSummary.run,
    validTime: ensAreaSummary.validTime,
    memberCount: ensAreaSummary.statistics.mean.memberCount,
    meanDistribution: ensAreaSummary.statistics.mean,
    p50Distribution: ensAreaSummary.spatialPercentiles?.[0]?.distribution,
    thresholdDistribution: ensAreaSummary.spatialThresholdFractions?.[0]?.distribution,
  },
}, null, 2));

const ensRunComparison = await new IfsEnsRunComparisonService().compareRuns({
  latitude: 50.08,
  longitude: 14.43,
  anchorRun: ens.run,
  validTime: ens.validTime,
  variable: "temperature",
  pressureLevelHpa: 850,
  members: ["p01", "p02"],
  quantiles: [0.1, 0.5, 0.9],
  cycles: 2,
  cycleStrideHours: 6,
});
assert.equal(ensRunComparison.model, "ifs_ens_0p25");
assert.equal(ensRunComparison.runs.length, 2);
assert.equal(ensRunComparison.comparisons.length, 1);
assert.equal(
  ensRunComparison.comparisons[0]?.interpretation,
  "distribution_shift_between_model_cycles_not_member_trajectory",
);
assert(Number.isFinite(ensRunComparison.comparisons[0]?.mean.delta));
assert.equal(ensRunComparison.source.product, "ifs_0p25_enfo_ef");

console.log(JSON.stringify({
  ifsEnsRunComparison: {
    validTime: ensRunComparison.validTime,
    runs: ensRunComparison.runs.map((snapshot) => ({
      run: snapshot.run,
      forecastHour: snapshot.forecastHour,
      mean: snapshot.summary.mean,
    })),
    meanShift: ensRunComparison.comparisons[0]?.mean,
  },
}, null, 2));

const crossModelComparison = await new GfsIfsComparisonService().compare({
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  validTime: result.validTime,
  variable: "temperature",
  pressureLevelHpa: 850,
});
assert.equal(crossModelComparison.run, result.run);
assert.equal(crossModelComparison.validTime, result.validTime);
assert.equal(crossModelComparison.gfs.model, "gfs_0p25");
assert.equal(crossModelComparison.ifs.model, "ifs_0p25");
assert(Number.isFinite(crossModelComparison.comparison.outputs[0]?.ifsMinusGfs));
assert.equal(
  crossModelComparison.comparison.interpretation,
  "raw_deterministic_model_difference_not_error_or_uncertainty",
);

console.log(JSON.stringify({
  crossModelComparison: {
    datasets: ["gfs", "ifs"],
    run: crossModelComparison.run,
    validTime: crossModelComparison.validTime,
    selection: crossModelComparison.selection,
    comparison: crossModelComparison.comparison,
  },
}, null, 2));


const sharedSelection = {
  variables: ["temperature"] as const,
  pressureLevelsHpa: [850] as const,
  fields: ["wind_10m"] as const,
};
const runTime = new Date(result.run);

const timeSeries = await new IfsTimeSeriesService().getTimeSeries({
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  startTime: runTime.toISOString(),
  endTime: result.validTime,
  variables: [...sharedSelection.variables],
  pressureLevelsHpa: [...sharedSelection.pressureLevelsHpa],
  fields: [...sharedSelection.fields],
});
assert(timeSeries.series.length >= 1);
assert.equal(timeSeries.run, result.run);
assert(timeSeries.series.every((step) => Number.isFinite(step.levels[0]?.temperatureC)));
assert(timeSeries.series.every((step) =>
  Number.isFinite(step.fields?.find((field) => field.id === "wind_10m")?.values.windSpeedMs)));

const points = await new IfsPointsService().getPoints({
  points: [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 49.20, longitude: 16.61 },
  ],
  run: result.run,
  validTime: result.validTime,
  variables: [...sharedSelection.variables],
  pressureLevelsHpa: [...sharedSelection.pressureLevelsHpa],
  fields: [...sharedSelection.fields],
});
assert.equal(points.points.length, 2);
assert.equal(points.run, result.run);
assert(points.points.every((sample) => Number.isFinite(sample.levels[0]?.temperatureC)));

const pointsTimeSeries = await new IfsPointsTimeSeriesService().getPointsTimeSeries({
  points: [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 49.20, longitude: 16.61 },
  ],
  run: result.run,
  startTime: runTime.toISOString(),
  endTime: result.validTime,
  variables: [...sharedSelection.variables],
  pressureLevelsHpa: [...sharedSelection.pressureLevelsHpa],
  fields: [...sharedSelection.fields],
  maxPointSteps: 20,
});
assert(pointsTimeSeries.series.length >= 1);
assert(pointsTimeSeries.series.every((step) => step.points.length === 2));

const transect = await new IfsTransectService().getTransect({
  start: { latitude: 49.8, longitude: 14.0 },
  end: { latitude: 50.3, longitude: 15.0 },
  run: result.run,
  validTime: result.validTime,
  variables: [...sharedSelection.variables],
  pressureLevelsHpa: [...sharedSelection.pressureLevelsHpa],
  fields: [...sharedSelection.fields],
  samples: 3,
});
assert.equal(transect.samples.length, 3);
assert(transect.totalDistanceKm > 0);
assert.equal(transect.samples[0]?.fraction, 0);
assert.equal(transect.samples[2]?.fraction, 1);

console.log(JSON.stringify({
  spatiotemporal: {
    timeSeriesSteps: timeSeries.series.length,
    points: points.points.length,
    pointTimeSeriesSteps: pointsTimeSeries.series.length,
    transectSamples: transect.samples.length,
    run: result.run,
  },
}, null, 2));


const diagnosticsService = new IfsDiagnosticsService();
const layerDiagnostics = await diagnosticsService.getLayerDiagnostics({
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  validTime: result.validTime,
  lowerPressureHpa: 850,
  upperPressureHpa: 500,
  diagnostics: [
    "temperature_lapse_rate",
    "wind_shear",
    "potential_temperature_gradient",
  ],
});
assert.equal(layerDiagnostics.model, "ifs_0p25");
assert.equal(layerDiagnostics.run, result.run);
assert(layerDiagnostics.layer.depthGpm > 0);
for (const diagnostic of layerDiagnostics.diagnostics) {
  assert(Object.values(diagnostic.values).every((value) => Number.isFinite(value)));
}

const parcelValidTime = ifsValidTimeForForecastHour(new Date(result.run), 6);
const parcelDiagnostics = await diagnosticsService.getParcelDiagnostics({
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  validTime: parcelValidTime.toISOString(),
  pressureLevelsHpa: [925, 850, 700, 600, 500, 400, 300],
  parcel: "surface_2m",
});
assert.equal(parcelDiagnostics.model, "ifs_0p25");
assert.equal(parcelDiagnostics.forecastHour, 6);
assert.equal(parcelDiagnostics.parcel.startingState.definition, "surface_2m");
assert(Number.isFinite(parcelDiagnostics.parcel.startingState.geopotentialHeightGpm));
assert(Number.isFinite(parcelDiagnostics.parcel.startingState.specificHumidityKgKg));
assert(Number.isFinite(parcelDiagnostics.parcel.capeJkg));
assert(Number.isFinite(parcelDiagnostics.parcel.cinJkg));

const diagnosticTimeSeries = await new IfsDiagnosticTimeSeriesService().getDiagnosticTimeSeries({
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  startTime: runTime.toISOString(),
  endTime: parcelValidTime.toISOString(),
  diagnostic: {
    kind: "parcel",
    pressureLevelsHpa: [925, 850, 700, 600, 500, 400, 300],
    parcel: "surface_2m",
  },
});
assert.deepEqual(diagnosticTimeSeries.series.map((step) => step.forecastHour), [0, 3, 6]);
assert(diagnosticTimeSeries.series.every((step) =>
  step.kind === "parcel"
  && Number.isFinite(step.parcel.capeJkg)
  && Number.isFinite(step.parcel.cinJkg)));

const profileDiagnostics = await diagnosticsService.getProfileDiagnostics({
  latitude: 50.08,
  longitude: 14.43,
  run: result.run,
  validTime: result.validTime,
  pressureLevelsHpa: [925, 850, 700, 600, 500, 400, 300],
  diagnostics: [
    "freezing_level_crossings",
    "temperature_inversion_layers",
  ],
});
assert.equal(profileDiagnostics.model, "ifs_0p25");
assert.equal(profileDiagnostics.run, result.run);
assert.equal(profileDiagnostics.levels.length, 7);
assert(profileDiagnostics.levels.every((level) =>
  Number.isFinite(level.temperatureC) && Number.isFinite(level.geopotentialHeightGpm)));
assert(profileDiagnostics.diagnostics.some((diagnostic) => diagnostic.id === "freezing_level_crossings"));
assert(profileDiagnostics.diagnostics.some((diagnostic) => diagnostic.id === "temperature_inversion_layers"));

const areaSummary = await new IfsAreaSummaryService().summarize({
  westLongitude: 14.0,
  eastLongitude: 14.5,
  southLatitude: 49.75,
  northLatitude: 50.25,
  run: result.run,
  validTime: result.validTime,
  variable: "temperature",
  pressureLevelHpa: 850,
  percentiles: [10, 50, 90],
  thresholds: [{ operator: "gte", value: 0 }],
  includeExtremaLocations: true,
  maxGridPoints: 100,
});
assert.equal(areaSummary.model, "ifs_0p25");
assert(areaSummary.statistics.definedGridPoints > 0);
assert(Number.isFinite(areaSummary.statistics.mean));
assert.equal(areaSummary.distribution?.percentiles?.length, 3);
assert(areaSummary.distribution?.extrema !== undefined);

const runComparison = await new IfsRunComparisonService().compareRuns({
  latitude: 50.08,
  longitude: 14.43,
  anchorRun: result.run,
  validTime: result.validTime,
  variables: ["temperature", "wind"],
  pressureLevelsHpa: [850],
  fields: ["wind_10m"],
  cycles: 2,
});
assert.equal(runComparison.model, "ifs_0p25");
assert.equal(runComparison.runs.length, 2);
assert.equal(runComparison.comparisons.length, 1);
const comparison = runComparison.comparisons[0];
assert(comparison);
assert(comparison.pressureLevels[0]?.changes.length);
assert(comparison.fields.some((field) =>
  field.id === "wind_10m" && field.comparable && field.changes.length > 0));

console.log(JSON.stringify({
  diagnostics: {
    layer: layerDiagnostics.diagnostics.map((diagnostic) => diagnostic.id),
    layerDepthGpm: layerDiagnostics.layer.depthGpm,
    profile: profileDiagnostics.diagnostics.map((diagnostic) => diagnostic.id),
    diagnosticTimeSeries: {
      kind: diagnosticTimeSeries.diagnostic.kind,
      steps: diagnosticTimeSeries.series.map((step) => step.forecastHour),
    },
    parcel: {
      definition: parcelDiagnostics.parcel.startingState.definition,
      forecastHour: parcelDiagnostics.forecastHour,
      surfaceGeopotentialHeightGpm: parcelDiagnostics.parcel.startingState.geopotentialHeightGpm,
      capeJkg: parcelDiagnostics.parcel.capeJkg,
      cinJkg: parcelDiagnostics.parcel.cinJkg,
    },
    sampledPressureLevelsHpa: profileDiagnostics.sampledPressureLevelsHpa,
    area: {
      definedGridPoints: areaSummary.statistics.definedGridPoints,
      mean: areaSummary.statistics.mean,
      p50: areaSummary.distribution?.percentiles?.find((item) => item.percentile === 50)?.value,
    },
    runComparison: {
      runs: runComparison.runs.map((snapshot) => ({
        run: snapshot.run,
        forecastHour: snapshot.forecastHour,
      })),
      transitions: runComparison.comparisons.length,
    },
    run: result.run,
  },
}, null, 2));
