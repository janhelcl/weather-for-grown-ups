import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import { aigfsValidTime, floorToAigfsCycle } from "../src/sources/aigfs.js";

const safelyPublishedRun = floorToAigfsCycle(new Date(Date.now() - 18 * 3_600_000));
const validTime = aigfsValidTime(safelyPublishedRun, 6);

const result = await new UnifiedAtmosphereQueryService().query({
  dataset: "aigfs",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: validTime.toISOString() },
  selection: {
    variables: ["temperature", "wind", "specific_humidity", "geopotential_height"],
    pressureLevelsHpa: [850, 700],
    fields: ["temperature_2m", "wind_10m", "mean_sea_level_pressure", "total_precipitation"],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
});

assert.equal(result.dataset, "aigfs");
assert.equal(result.internalDatasetId, "aigfs_0p25");
assert.equal(result.kind, "deterministic");
assert.equal(result.role, "forecast");

const profile = result.result as any;
assert.equal(profile.model, "aigfs_0p25");
assert.equal(profile.validTime, validTime.toISOString());
assert.equal(profile.forecastHour % 6, 0);
assert.equal(profile.levels.length, 2);
assert(profile.levels.every((level: any) => Number.isFinite(level.temperatureC)));
assert(profile.levels.every((level: any) => Number.isFinite(level.windSpeedMs)));
assert(profile.levels.every((level: any) => Number.isFinite(level.specificHumidityKgKg)));
assert(profile.levels.every((level: any) => Number.isFinite(level.geopotentialHeightGpm)));

for (const field of ["temperature_2m", "wind_10m", "mean_sea_level_pressure", "total_precipitation"]) {
  assert(profile.fields.some((item: any) => item.id === field), `missing AIGFS field ${field}`);
}
assert.equal(profile.source.provider, "NOAA NOMADS");
assert.equal(profile.source.access, "nomads_range");
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
