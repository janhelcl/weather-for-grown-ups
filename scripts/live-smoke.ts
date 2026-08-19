import assert from "node:assert/strict";
import { LatestRunResolver } from "../src/core/latest-run.js";
import { ProfileService } from "../src/core/profile.js";

const latestRunResolver = new LatestRunResolver();
const run = await latestRunResolver.resolveLatestRun();
const validTime = new Date(run.getTime() + 6 * 60 * 60 * 1000);
const service = new ProfileService({ latestRunProvider: latestRunResolver });

const result = await service.getProfile({
  latitude: 50.08,
  longitude: 14.43,
  run: run.toISOString(),
  validTime: validTime.toISOString(),
  variables: ["temperature", "relative_humidity", "wind"],
  pressureLevelsHpa: [850, 700, 500],
});

assert.equal(result.model, "gfs_0p25");
assert.equal(result.run, run.toISOString());
assert.equal(result.forecastHour, 6);
assert.equal(result.levels.length, 3);
assert(result.levels.some((level) => level.temperatureC !== undefined));
assert(result.levels.some((level) => level.windSpeedMs !== undefined));

console.log(JSON.stringify(result, null, 2));
