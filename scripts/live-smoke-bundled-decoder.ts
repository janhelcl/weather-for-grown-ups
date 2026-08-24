import assert from "node:assert/strict";
import { AreaSummaryService } from "../src/core/area-summary.js";
import { GefsEnsembleService } from "../src/core/gefs-ensemble.js";
import { GefsLatestRunResolver } from "../src/core/gefs-latest-run.js";
import { latestGefsCycleAtOrBefore } from "../src/core/gefs-time.js";
import { LatestRunResolver } from "../src/core/latest-run.js";
import { ProfileService } from "../src/core/profile.js";

const HOUR_MS = 3_600_000;

assert.notEqual(
  process.env.WFG_DECODER,
  "wgrib2",
  "Bundled-decoder smoke must not opt into native wgrib2",
);
assert.equal(
  process.env.WGRIB2_PATH,
  undefined,
  "Bundled-decoder smoke must not configure WGRIB2_PATH",
);

const latestGfsRun = new LatestRunResolver();
const gfsRun = await latestGfsRun.resolveLatestRun();
const gfsValidTime = new Date(gfsRun.getTime() + 6 * HOUR_MS);
const profileService = new ProfileService({ latestRunProvider: latestGfsRun });

const profile = await profileService.getProfile({
  latitude: 50.08,
  longitude: 14.43,
  run: gfsRun.toISOString(),
  validTime: gfsValidTime.toISOString(),
  variables: ["temperature", "relative_humidity", "wind"],
  pressureLevelsHpa: [850, 700, 500],
  fields: [
    "temperature_2m",
    "total_precipitation",
    "low_cloud_cover_average",
  ],
  source: "s3",
});

assert.equal(profile.model, "gfs_0p25");
assert.equal(profile.source.provider, "NOAA AWS Open Data");
assert.equal(profile.source.access, "s3_range");
assert.equal(profile.source.decoder, "gribberish");
assert.equal(profile.levels.length, 3);
assert(profile.levels.every((level) => Number.isFinite(level.temperatureC)));
assert(profile.levels.every((level) => Number.isFinite(level.windSpeedMs)));

const temperature2m = profile.fields?.find((field) => field.id === "temperature_2m");
assert(temperature2m);
assert.deepEqual(temperature2m.temporal, { type: "instantaneous" });

const precipitation = profile.fields?.find((field) => field.id === "total_precipitation");
assert(precipitation);
assert.equal(precipitation.temporal.type, "accumulation");
if (precipitation.temporal.type !== "accumulation") {
  throw new Error("Expected live total precipitation accumulation semantics");
}
assert(precipitation.temporal.endForecastHour > precipitation.temporal.startForecastHour);

const lowCloudAverage = profile.fields?.find((field) => field.id === "low_cloud_cover_average");
assert(lowCloudAverage);
assert.equal(lowCloudAverage.temporal.type, "average");
if (lowCloudAverage.temporal.type !== "average") {
  throw new Error("Expected live low cloud cover average semantics");
}
assert(lowCloudAverage.temporal.endForecastHour > lowCloudAverage.temporal.startForecastHour);

const areaService = new AreaSummaryService({ latestRunProvider: latestGfsRun });
const area = await areaService.summarize({
  westLongitude: 13.5,
  eastLongitude: 14.5,
  southLatitude: 49.75,
  northLatitude: 50.25,
  run: gfsRun.toISOString(),
  validTime: gfsValidTime.toISOString(),
  field: "temperature_2m",
  percentiles: [10, 50, 90],
  thresholds: [{ operator: "gte", value: 0 }],
  includeExtremaLocations: true,
});

assert.equal(area.model, "gfs_0p25");
assert.equal(area.source.provider, "NOAA NOMADS");
assert.equal(area.source.access, "nomads_grib_filter");
assert.equal(area.source.decoder, "gribberish");
assert(area.statistics.definedGridPoints > 0);
assert.equal(area.distribution?.percentiles?.length, 3);
assert(area.distribution?.extrema);

const gefsMembers = ["c00", "p01"] as const;
const gefsValidTime = latestGefsCycleAtOrBefore(new Date());
const latestGefsRun = new GefsLatestRunResolver();
const gefsRun = await latestGefsRun.resolveLatestRun(gefsValidTime, gefsMembers);
const gefsService = new GefsEnsembleService({ latestRunProvider: latestGefsRun });
const ensemble = await gefsService.getEnsemble({
  latitude: 50.08,
  longitude: 14.43,
  run: gefsRun.toISOString(),
  validTime: gefsValidTime.toISOString(),
  variable: "temperature",
  pressureLevelHpa: 850,
  members: [...gefsMembers],
  quantiles: [0.1, 0.5, 0.9],
});

assert.equal(ensemble.model, "gefs_0p50");
assert.equal(ensemble.source.provider, "NOAA AWS Open Data");
assert.equal(ensemble.source.access, "s3_range");
assert.equal(ensemble.source.decoder, "gribberish");
assert.equal(ensemble.members.length, gefsMembers.length);
assert(ensemble.members.every((member) => Number.isFinite(member.value)));
assert(Number.isFinite(ensemble.summary.mean));
assert(Number.isFinite(ensemble.summary.populationStdDev));

console.log(JSON.stringify({
  decoder: "gribberish",
  gfs: {
    run: gfsRun.toISOString(),
    validTime: gfsValidTime.toISOString(),
    pressureLevels: profile.levels.length,
    fields: profile.fields?.map((field) => ({ id: field.id, temporal: field.temporal })) ?? [],
    areaDefinedGridPoints: area.statistics.definedGridPoints,
  },
  gefs: {
    run: gefsRun.toISOString(),
    validTime: gefsValidTime.toISOString(),
    members: ensemble.members.map((member) => member.member),
    mean: ensemble.summary.mean,
    populationStdDev: ensemble.summary.populationStdDev,
  },
}, null, 2));
