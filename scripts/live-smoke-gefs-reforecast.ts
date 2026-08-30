import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";

const service = new UnifiedAtmosphereQueryService();
const result = await service.query({
  dataset: "gefs",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: "2017-03-14T12:00:00Z" },
  selection: { fields: ["temperature_2m"] },
  forecast: {
    kind: "reforecast",
    run: "2017-03-14T00:00:00Z",
  },
  ensemble: {
    members: ["c00", "p01", "p02", "p03", "p04"],
    quantiles: [0.1, 0.5, 0.9],
    includeMembers: true,
  },
});

assert.equal(result.dataset, "gefs");
assert.equal(result.internalDatasetId, "gefs_v12_reforecast");
assert.equal(result.kind, "ensemble");
assert.equal(result.role, "forecast");

const reforecast = result.result as any;
assert.equal(reforecast.model, "gefs_v12_reforecast");
assert.equal(reforecast.run, "2017-03-14T00:00:00.000Z");
assert.equal(reforecast.validTime, "2017-03-14T12:00:00.000Z");
assert.equal(reforecast.forecastHour, 12);
assert.deepEqual(reforecast.selection.members, ["c00", "p01", "p02", "p03", "p04"]);
assert.equal(reforecast.fieldSummaries.length, 1);
assert.equal(reforecast.fieldSummaries[0].field, "temperature_2m");
assert.equal(reforecast.fieldSummaries[0].outputs[0].aggregation, "numeric_distribution");
assert.equal(reforecast.fieldSummaries[0].outputs[0].distribution.memberCount, 5);
assert(Number.isFinite(reforecast.fieldSummaries[0].outputs[0].distribution.mean));
assert.equal(reforecast.members.length, 5);
assert.equal(reforecast.source.provider, "NOAA AWS Open Data");
assert.equal(reforecast.source.access, "s3_range");
assert.equal(reforecast.source.archiveType, "reforecast");
assert.equal(reforecast.source.dataset, "GEFSv12/reforecast");
assert.equal(reforecast.source.leadBlock, "Days:1-10");
assert.equal(reforecast.source.horizontalGridDegrees, 0.25);

const profileResult = await service.query({
  dataset: "gefs",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: "2017-03-14T12:00:00Z" },
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850, 500],
  },
  forecast: {
    kind: "reforecast",
    run: "2017-03-14T00:00:00Z",
  },
  ensemble: {
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
});
const profile = profileResult.result as any;
assert.equal(profileResult.internalDatasetId, "gefs_v12_reforecast");
assert.equal(profile.model, "gefs_v12_reforecast");
assert.deepEqual(profile.selection.pressureLevelsHpa, [850, 500]);
assert.equal(profile.summaries.length, 2);
assert.equal(profile.summaries[0].variable, "temperature");
assert.equal(profile.summaries[0].memberCount, 2);
assert(Number.isFinite(profile.summaries[0].mean));
assert.equal(profile.source.archiveType, "reforecast");
assert.equal(profile.source.horizontalGridDegrees, 0.5);
assert.equal(profile.source.profileGridPolicy, "coherent_0p50");
assert.deepEqual(profile.gridPoint, { latitude: 50, longitude: 14.5 });


const rangeResult = await service.query({
  dataset: "gefs",
  geometry: { type: "point", latitude: 50.13, longitude: 14.37 },
  time: {
    from: "2017-03-23T21:00:00Z",
    to: "2017-03-24T06:00:00Z",
    maxSteps: 3,
  },
  selection: { fields: ["temperature_2m"] },
  forecast: {
    kind: "reforecast",
    run: "2017-03-14T00:00:00Z",
  },
  ensemble: {
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
});
const range = rangeResult.result as any;
assert.equal(rangeResult.internalDatasetId, "gefs_v12_reforecast");
assert.equal(rangeResult.timeType, "range");
assert.deepEqual(
  range.series.map((step: any) => step.forecastHour),
  [237, 240, 246],
);
assert.deepEqual(
  range.series.map((step: any) => step.source.horizontalGridDegrees),
  [0.25, 0.25, 0.5],
);
assert.deepEqual(range.source.nativeCadence, [
  { fromForecastHour: 3, throughForecastHour: 240, stepHours: 3 },
  { fromForecastHour: 246, throughForecastHour: 384, stepHours: 6 },
]);
for (const step of range.series) {
  assert.equal(step.kind, "fields");
  assert.equal(step.fieldSummaries[0].field, "temperature_2m");
  assert(Number.isFinite(step.fieldSummaries[0].outputs[0].distribution.mean));
}


const pointsResult = await service.query({
  dataset: "gefs",
  geometry: {
    type: "points",
    points: [
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 49.2, longitude: 16.61 },
    ],
  },
  time: { at: "2017-03-14T12:00:00Z" },
  selection: { fields: ["temperature_2m"] },
  forecast: {
    kind: "reforecast",
    run: "2017-03-14T00:00:00Z",
  },
  ensemble: {
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
});
const points = pointsResult.result as any;
assert.equal(pointsResult.internalDatasetId, "gefs_v12_reforecast");
assert.equal(pointsResult.geometryType, "points");
assert.equal(pointsResult.timeType, "instant");
assert.equal(points.kind, "fields");
assert.equal(points.points.length, 2);
assert.deepEqual(
  points.points.map((point: any) => point.requestedPoint),
  [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 49.2, longitude: 16.61 },
  ],
);
assert.equal(points.source.horizontalGridDegrees, 0.25);
for (const point of points.points) {
  assert.equal(point.fieldSummaries[0].field, "temperature_2m");
  assert(Number.isFinite(point.fieldSummaries[0].outputs[0].distribution.mean));
}


const pointsRangeResult = await service.query({
  dataset: "gefs",
  geometry: {
    type: "points",
    points: [
      { latitude: 50.13, longitude: 14.37 },
      { latitude: 49.2, longitude: 16.61 },
    ],
  },
  time: {
    from: "2017-03-23T21:00:00Z",
    to: "2017-03-24T06:00:00Z",
    maxSteps: 3,
  },
  selection: { fields: ["temperature_2m"] },
  forecast: {
    kind: "reforecast",
    run: "2017-03-14T00:00:00Z",
  },
  ensemble: {
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  limits: { maxPointSteps: 6 },
});
const pointsRange = pointsRangeResult.result as any;
assert.equal(pointsRangeResult.internalDatasetId, "gefs_v12_reforecast");
assert.equal(pointsRangeResult.geometryType, "points");
assert.equal(pointsRangeResult.timeType, "range");
assert.deepEqual(
  pointsRange.series.map((step: any) => step.forecastHour),
  [237, 240, 246],
);
assert.deepEqual(
  pointsRange.series.map((step: any) => step.source.horizontalGridDegrees),
  [0.25, 0.25, 0.5],
);
assert.deepEqual(
  pointsRange.series[0].points.map((point: any) => point.requestedPoint),
  [
    { latitude: 50.13, longitude: 14.37 },
    { latitude: 49.2, longitude: 16.61 },
  ],
);
assert.notDeepEqual(
  pointsRange.series[0].points.map((point: any) => point.gridPoint),
  pointsRange.series[2].points.map((point: any) => point.gridPoint),
);
for (const step of pointsRange.series) {
  assert.equal(step.kind, "fields");
  assert.equal(step.points.length, 2);
  for (const point of step.points) {
    assert.equal(point.fieldSummaries[0].field, "temperature_2m");
    assert(Number.isFinite(point.fieldSummaries[0].outputs[0].distribution.mean));
  }
}

console.log(JSON.stringify({
  dataset: result.dataset,
  internalDatasetId: result.internalDatasetId,
  run: reforecast.run,
  validTime: reforecast.validTime,
  forecastHour: reforecast.forecastHour,
  members: reforecast.selection.members,
  temperature2m: reforecast.fieldSummaries[0],
  source: reforecast.source,
  profile: {
    selection: profile.selection,
    summaries: profile.summaries,
    source: profile.source,
  },
  range: {
    selection: range.selection,
    series: range.series,
    source: range.source,
  },
  points: {
    selection: points.selection,
    points: points.points,
    source: points.source,
  },
  pointsRange: {
    selection: pointsRange.selection,
    series: pointsRange.series,
    source: pointsRange.source,
  },
}, null, 2));
