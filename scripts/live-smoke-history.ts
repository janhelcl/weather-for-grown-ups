import assert from "node:assert/strict";
import { HistoricalTimeSeriesService } from "../src/core/history-time-series.js";
import { HistoricalForecastSkillService } from "../src/core/history-skill.js";
import { HistoricalForecastVerificationService } from "../src/core/history-verification.js";
import { HistoricalProfileService } from "../src/core/history.js";

const FORECAST_NCSS_TIMEOUT_MS = 45_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms (NCEI NCSS likely hung)`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
assert.equal(result.source.access, "ncei_thredds_fileserver");
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

const awsAnalysisTime = "2024-06-01T00:00:00Z";
const awsResult = await service.getHistoricalProfile({
  latitude: 50.08,
  longitude: 14.43,
  analysisTime: awsAnalysisTime,
  variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
  pressureLevelsHpa: [850, 700],
});
assert.equal(awsResult.source.provider, "NOAA AWS Open Data");
assert.equal(awsResult.source.access, "s3_range");
assert.match(awsResult.source.dataset, /gfs\.t00z\.pgrb2\.0p50\.f000$/);
assert.deepEqual(awsResult.levels.map((level) => level.pressureHpa), [850, 700]);
for (const level of awsResult.levels) {
  assert(Number.isFinite(level.temperatureC));
  assert(Number.isFinite(level.relativeHumidityPct));
  assert(Number.isFinite(level.windSpeedMs));
  assert(Number.isFinite(level.geopotentialHeightGpm));
}
const aws700 = awsResult.levels.find((level) => level.pressureHpa === 700);
assert.ok(aws700?.geopotentialHeightGpm !== undefined
  && aws700.geopotentialHeightGpm > 2500
  && aws700.geopotentialHeightGpm < 3500);

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

const analysisSummary = {
  profile: {
    analysisTime: result.analysisTime,
    requestedPoint: result.requestedPoint,
    gridPoint: result.gridPoint,
    levels: result.levels,
    source: result.source,
  },
  awsProfile: {
    analysisTime: awsResult.analysisTime,
    gridPoint: awsResult.gridPoint,
    levels: awsResult.levels,
    source: awsResult.source,
  },
  timeSeries: {
    requestedStartTime: timeSeries.requestedStartTime,
    requestedEndTime: timeSeries.requestedEndTime,
    selection: timeSeries.selection,
    series: timeSeries.series,
    source: timeSeries.source,
  },
  caveat: result.caveat,
};

// Archived Grid 4 forecast still goes through NCEI NCSS, which currently hangs
// behind the broken S3 IAM path. Bound the wait so analysis routing stays
// observable when forecast NCSS is down.
try {
  const verificationService = new HistoricalForecastVerificationService({ analysisGetter: service });
  const verification = await withTimeout(verificationService.verify({
    latitude: 50.08,
    longitude: 14.43,
    validTime: "2019-12-26T18:00:00Z",
    leadHours: 54,
    variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
    pressureLevelsHpa: [850, 700],
  }), FORECAST_NCSS_TIMEOUT_MS, "archived forecast verification");

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
  const skill = await withTimeout(skillService.summarize({
    latitude: 50.08,
    longitude: 14.43,
    startTime: "2019-12-26T18:00:00Z",
    endTime: "2019-12-26T18:00:00Z",
    cycleHoursUtc: [18],
    leadHours: [54],
    variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
    pressureLevelsHpa: [850, 700],
    maxValidTimes: 1,
  }), FORECAST_NCSS_TIMEOUT_MS, "archived forecast skill");

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
    ...analysisSummary,
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
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ...analysisSummary,
    forecastArchive: {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
      note: "gfs-analysis routing (fileServer + AWS) succeeded; archived forecast still depends on NCEI NCSS",
    },
  }, null, 2));
  throw error;
}
