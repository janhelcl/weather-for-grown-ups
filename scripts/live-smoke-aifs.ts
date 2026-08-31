import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import { aifsValidTime, latestAifsCycleAtOrBefore } from "../src/core/aifs-time.js";

const safelyPublishedRun = latestAifsCycleAtOrBefore(
  new Date(Date.now() - 18 * 3_600_000),
);
const validTime = aifsValidTime(safelyPublishedRun, 6);

const result = await new UnifiedAtmosphereQueryService().query({
  dataset: "aifs",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: validTime.toISOString() },
  selection: {
    variables: ["temperature", "wind", "specific_humidity", "geopotential_height"],
    pressureLevelsHpa: [850, 700],
    fields: [
      "temperature_2m",
      "wind_10m",
      "mean_sea_level_pressure",
      "total_precipitation",
    ],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
});

assert.equal(result.dataset, "aifs");
assert.equal(result.internalDatasetId, "aifs_0p25");
assert.equal(result.kind, "deterministic");
assert.equal(result.role, "forecast");

const profile = result.result as any;
assert.equal(profile.model, "aifs_0p25");
assert.equal(profile.validTime, validTime.toISOString());
assert.equal(profile.forecastHour, 6);
assert.equal(profile.levels.length, 2);
assert(profile.levels.every((level: any) => Number.isFinite(level.temperatureC)));
assert(profile.levels.every((level: any) => Number.isFinite(level.windSpeedMs)));
assert(profile.levels.every((level: any) => Number.isFinite(level.specificHumidityKgKg)));
assert(profile.levels.every((level: any) => Number.isFinite(level.geopotentialHeightGpm)));

for (const field of [
  "temperature_2m",
  "wind_10m",
  "mean_sea_level_pressure",
  "total_precipitation",
]) {
  assert(profile.fields.some((item: any) => item.id === field), `missing AIFS field ${field}`);
}
assert.equal(profile.source.provider, "ECMWF Open Data");
assert.equal(profile.source.access, "indexed_http_range");
assert.equal(profile.source.product, "aifs_single_0p25_oper_fc");
assert.equal(profile.source.horizontalGridDegrees, 0.25);
assert(["gribberish", "wgrib2"].includes(profile.source.decoder));

console.log(JSON.stringify({
  dataset: result.dataset,
  internalDatasetId: result.internalDatasetId,
  run: profile.run,
  validTime: profile.validTime,
  forecastHour: profile.forecastHour,
  gridPoint: profile.gridPoint,
  levels: profile.levels,
  fields: profile.fields,
  source: profile.source,
}, null, 2));
