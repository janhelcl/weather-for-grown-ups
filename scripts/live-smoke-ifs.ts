import assert from "node:assert/strict";
import { IfsAreaSummaryService } from "../src/core/ifs-area-summary.js";
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
import { ifsValidTimeForForecastHour, latestIfsCycleAtOrBefore } from "../src/core/ifs-time.js";

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
assert(runComparison.comparisons[0]?.pressureLevels[0]?.changes.length > 0);
assert(runComparison.comparisons[0]?.fields.some((field) =>
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
