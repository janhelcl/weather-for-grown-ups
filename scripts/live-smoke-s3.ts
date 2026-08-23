import assert from "node:assert/strict";
import { BatchPointsService } from "../src/core/batch-points.js";
import { LatestRunResolver } from "../src/core/latest-run.js";
import { ParcelDiagnosticsService } from "../src/core/parcel-diagnostics.js";
import { ProfileService } from "../src/core/profile.js";
import { TimeSeriesService } from "../src/core/time-series.js";
import { TransectService } from "../src/core/transect.js";

const HOUR_MS = 3_600_000;
const latestRunResolver = new LatestRunResolver();
const run = await latestRunResolver.resolveLatestRun();
const f006 = new Date(run.getTime() + 6 * HOUR_MS);
const f009 = new Date(run.getTime() + 9 * HOUR_MS);

const profileService = new ProfileService({ latestRunProvider: latestRunResolver });
const batchService = new BatchPointsService({
  latestRunProvider: latestRunResolver,
  profileGetter: profileService,
});
const timeSeriesService = new TimeSeriesService({
  latestRunProvider: latestRunResolver,
  profileGetter: profileService,
});
const transectService = new TransectService({ batchPointsGetter: batchService });
const parcelService = new ParcelDiagnosticsService({ profileGetter: profileService });

const points = await batchService.getPoints({
  points: [
    { latitude: 50.08, longitude: 14.43 },
    { latitude: 45.80, longitude: 11.70 },
    { latitude: 46.24, longitude: 13.18 },
  ],
  run: run.toISOString(),
  validTime: f006.toISOString(),
  variables: ["temperature", "wind"],
  pressureLevelsHpa: [850, 700],
  fields: ["temperature_2m", "wind_10m", "low_cloud_cover"],
});
assert.equal(points.model, "gfs_0p25");
assert.equal(points.run, run.toISOString());
assert.equal(points.forecastHour, 6);
assert.equal(points.points.length, 3);
assert.equal(points.source.provider, "NOAA AWS Open Data");
assert.equal(points.source.access, "s3_range");
for (const point of points.points) {
  assert.equal(point.levels.length, 2);
  assert(point.levels.every((level) => level.temperatureC !== undefined));
  assert(point.levels.every((level) => level.windSpeedMs !== undefined));
  assert(point.fields?.some((field) => field.id === "temperature_2m"));
  assert(point.fields?.some((field) => field.id === "wind_10m"));
  assert(point.fields?.some((field) => field.id === "low_cloud_cover"));
}

const timeSeries = await timeSeriesService.getTimeSeries({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  startTime: f006.toISOString(),
  endTime: f009.toISOString(),
  variables: ["temperature", "wind"],
  pressureLevelsHpa: [850, 700],
  fields: ["temperature_2m"],
  source: "s3",
  maxSteps: 10,
});
assert.equal(timeSeries.model, "gfs_0p25");
assert.equal(timeSeries.run, run.toISOString());
assert.deepEqual(timeSeries.series.map((step) => step.forecastHour), [6, 7, 8, 9]);
assert(timeSeries.series.every((step) => step.levels.length === 2));
assert(timeSeries.series.every((step) => step.fields?.some((field) => field.id === "temperature_2m")));

const transect = await transectService.getTransect({
  start: { latitude: 50.08, longitude: 14.43 },
  end: { latitude: 46.24, longitude: 13.18 },
  run: run.toISOString(),
  validTime: f006.toISOString(),
  variables: ["temperature", "relative_humidity", "wind"],
  pressureLevelsHpa: [850, 700, 500],
  samples: 5,
});
assert.equal(transect.model, "gfs_0p25");
assert.equal(transect.run, run.toISOString());
assert.equal(transect.samples.length, 5);
assert(transect.totalDistanceKm > 0);
assert.equal(transect.source.provider, "NOAA AWS Open Data");
assert.equal(transect.source.access, "s3_range");
assert(transect.samples.every((sample) => sample.levels.length === 3));

const parcel = await parcelService.getParcelDiagnostics({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  validTime: f006.toISOString(),
  pressureLevelsHpa: [925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200],
  parcel: "surface_2m",
  source: "s3",
});
assert.equal(parcel.model, "gfs_0p25");
assert.equal(parcel.run, run.toISOString());
assert.equal(parcel.source.provider, "NOAA AWS Open Data");
assert.equal(parcel.source.access, "s3_range");
assert.equal(parcel.parcel.startingState.definition, "surface_2m");
assert(Number.isFinite(parcel.parcel.lcl.pressureHpa));
assert(Number.isFinite(parcel.parcel.capeJkg));
assert(Number.isFinite(parcel.parcel.cinJkg));

console.log(JSON.stringify({
  run: run.toISOString(),
  validTime: f006.toISOString(),
  batch: {
    points: points.points.length,
    pressureLevels: points.points[0]?.levels.length ?? 0,
    cacheHit: points.source.cacheHit,
  },
  timeSeries: {
    steps: timeSeries.series.length,
    forecastHours: timeSeries.series.map((step) => step.forecastHour),
  },
  transect: {
    samples: transect.samples.length,
    totalDistanceKm: transect.totalDistanceKm,
    cacheHit: transect.source.cacheHit,
  },
  parcel: {
    capeJkg: parcel.parcel.capeJkg,
    cinJkg: parcel.parcel.cinJkg,
    lclPressureHpa: parcel.parcel.lcl.pressureHpa,
  },
}, null, 2));
