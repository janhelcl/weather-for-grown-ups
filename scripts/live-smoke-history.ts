import assert from "node:assert/strict";
import { HistoricalTimeSeriesService } from "../src/core/history-time-series.js";
import { HistoricalForecastSkillService } from "../src/core/history-skill.js";
import { HistoricalForecastVerificationService } from "../src/core/history-verification.js";
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

// NCEI's THREDDS catalog exposes this exact 2019 Grid 4 forecast file:
// gfs_4_20191224_1200_054.grb2. It verifies at 2019-12-26 18 UTC.
const verificationService = new HistoricalForecastVerificationService({ analysisGetter: service });
const verification = await verificationService.verify({
  latitude: 50.08,
  longitude: 14.43,
  validTime: "2019-12-26T18:00:00Z",
  leadHours: 54,
  variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
  pressureLevelsHpa: [850, 700],
});

assert.equal(verification.model, "gfs_grid4_archive_verification_0p5");
assert.equal(verification.forecastRun, "2019-12-24T12:00:00.000Z");
assert.equal(verification.forecast.forecastHour, 54);
assert.equal(verification.validTime, "2019-12-26T18:00:00.000Z");
assert.match(verification.forecast.dataset, /gfs_4_20191224_1200_054\.grb2$/);
assert.match(verification.analysis.dataset, /gfsanl_4_20191226_1800_000\.grb2$/);
assert.equal(verification.comparison, "analysis_minus_forecast");
for (const level of verification.pressureLevels) {
  assert(level.changes.length > 0);
  for (const change of level.changes) assert(Number.isFinite(change.delta));
}

const skillService = new HistoricalForecastSkillService({ verifier: verificationService });
const skill = await skillService.summarize({
  latitude: 50.08,
  longitude: 14.43,
  startTime: "2019-12-26T18:00:00Z",
  endTime: "2019-12-26T18:00:00Z",
  cycleHoursUtc: [18],
  leadHours: [54],
  variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
  pressureLevelsHpa: [850, 700],
  maxValidTimes: 1,
});

assert.equal(skill.model, "gfs_grid4_analysis_skill_summary_0p5");
assert.equal(skill.comparison, "analysis_minus_forecast");
assert.deepEqual(skill.availability, {
  requestedEvaluations: 1,
  successfulEvaluations: 1,
  failedEvaluations: 0,
  successRate: 1,
});
assert(skill.statistics.length > 0);
for (const statistic of skill.statistics) {
  assert.equal(statistic.count, 1);
  assert(Number.isFinite(statistic.bias));
  assert(Number.isFinite(statistic.mae));
  assert(Number.isFinite(statistic.rmse));
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
  verification: {
    validTime: verification.validTime,
    forecastRun: verification.forecastRun,
    leadHours: verification.leadHours,
    pressureLevels: verification.pressureLevels,
    forecastDataset: verification.forecast.dataset,
    analysisDataset: verification.analysis.dataset,
  },
  skill: {
    period: skill.period,
    leadHours: skill.leadHours,
    availability: skill.availability,
    statistics: skill.statistics,
  },
  caveat: result.caveat,
}, null, 2));
