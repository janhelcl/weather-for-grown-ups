import assert from "node:assert/strict";
import { HistoricalTimeSeriesService } from "../src/core/history-time-series.js";
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

const timeSeriesService = new HistoricalTimeSeriesService({ profileGetter: service });
const timeSeries = await timeSeriesService.getHistoricalTimeSeries({
  latitude: 50.08,
  longitude: 14.43,
  startTime: "2017-05-09T00:00:00Z",
  endTime: "2017-05-10T23:59:59Z",
  cycleHoursUtc: [12],
  variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
  pressureLevelsHpa: [850, 700],
  maxSteps: 2,
});

assert.equal(timeSeries.model, "gfs_grid4_analysis_0p5");
assert.deepEqual(timeSeries.selection.cycleHoursUtc, [12]);
assert.deepEqual(timeSeries.series.map((step) => step.analysisTime), [
  "2017-05-09T12:00:00.000Z",
  "2017-05-10T12:00:00.000Z",
]);
assert.match(timeSeries.series[0]?.dataset ?? "", /gfsanl_4_20170509_1200_000\.grb2$/);
assert.match(timeSeries.series[1]?.dataset ?? "", /gfsanl_4_20170510_1200_000\.grb2$/);
for (const step of timeSeries.series) {
  assert.deepEqual(step.levels.map((level) => level.pressureHpa), [850, 700]);
  for (const level of step.levels) {
    assert(Number.isFinite(level.temperatureC));
    assert(Number.isFinite(level.relativeHumidityPct));
    assert(Number.isFinite(level.windSpeedMs));
    assert(Number.isFinite(level.geopotentialHeightGpm));
  }
}

console.log(JSON.stringify({
  profile: {
    analysisTime: result.analysisTime,
    requestedPoint: result.requestedPoint,
    gridPoint: result.gridPoint,
    levels: result.levels,
    source: result.source,
  },
  timeSeries: {
    requestedStartTime: timeSeries.requestedStartTime,
    requestedEndTime: timeSeries.requestedEndTime,
    selection: timeSeries.selection,
    series: timeSeries.series,
    source: timeSeries.source,
  },
  caveat: result.caveat,
}, null, 2));
