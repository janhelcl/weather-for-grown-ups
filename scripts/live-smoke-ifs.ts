import assert from "node:assert/strict";
import { IfsProfileService } from "../src/core/ifs-profile.js";
import { latestIfsCycleAtOrBefore } from "../src/core/ifs-time.js";

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
    "wind",
    "dew_point",
  ],
  pressureLevelsHpa: [850, 500],
  fields: [
    "temperature_2m",
    "dew_point_2m",
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
assert(result.fields?.some((field) => field.id === "temperature_2m"));
assert(result.fields?.some((field) => field.id === "wind_10m"));
assert(result.fields?.some((field) => field.id === "wind_100m"));
assert(result.fields?.some((field) => field.id === "precipitable_water"));
assert.equal(result.source.provider, "ECMWF Open Data");
assert.equal(result.source.access, "s3_range");
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
