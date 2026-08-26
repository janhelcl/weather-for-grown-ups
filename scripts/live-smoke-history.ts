import assert from "node:assert/strict";
import { HistoricalProfileService } from "../src/core/history.js";

const service = new HistoricalProfileService();
const analysisTime = "2017-05-09T12:00:00Z";
const result = await service.getHistoricalProfile({
  latitude: 50.08,
  longitude: 14.43,
  analysisTime,
  variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
  pressureLevelsHpa: [850, 700],
});

assert.equal(result.model, "gfs_grid4_analysis_0p5");
assert.equal(result.analysisTime, "2017-05-09T12:00:00.000Z");
assert.equal(result.source.provider, "NOAA NCEI");
assert.equal(result.source.access, "ncei_thredds_ncss");
assert.match(result.source.dataset, /gfsanl_4_20170509_1200_000\.grb2$/);
assert.deepEqual(result.levels.map((level) => level.pressureHpa), [850, 700]);
for (const level of result.levels) {
  assert(Number.isFinite(level.temperatureC));
  assert(Number.isFinite(level.relativeHumidityPct));
  assert(Number.isFinite(level.uWindMs));
  assert(Number.isFinite(level.vWindMs));
  assert(Number.isFinite(level.windSpeedMs));
  assert(Number.isFinite(level.windDirectionDeg));
  assert(Number.isFinite(level.geopotentialHeightGpm));
}

console.log(JSON.stringify({
  analysisTime: result.analysisTime,
  requestedPoint: result.requestedPoint,
  gridPoint: result.gridPoint,
  levels: result.levels,
  source: result.source,
  caveat: result.caveat,
}, null, 2));
