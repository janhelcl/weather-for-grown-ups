import assert from "node:assert/strict";
import { HistoricalForecastVerificationService } from "../src/core/history-verification.js";
import { HistoricalProfileService } from "../src/core/history.js";

const POINT = { latitude: 50.08, longitude: 14.43 };
const VARIABLES = ["temperature", "relative_humidity", "wind", "geopotential_height"] as const;
const PRESSURE_LEVELS = [850, 700] as const;

const service = new HistoricalProfileService();

// NCEI's current GFS access contract sends recent 0.5° analysis/forecast data
// through NOAA AWS Open Data. Use a recent completed 00Z cycle well inside the
// trailing cloud window so this check validates the production routing rather
// than the retired THREDDS/NCSS path.
const recentAnalysisTime = recentUtcCycle(3);
const recent = await service.getHistoricalProfile({
  ...POINT,
  analysisTime: recentAnalysisTime,
  variables: [...VARIABLES],
  pressureLevelsHpa: [...PRESSURE_LEVELS],
});

assert.equal(recent.source.provider, "NOAA AWS Open Data");
assert.equal(recent.source.access, "s3_range");
assert.match(recent.source.dataset, /gfs\.t00z\.pgrb2\.0p50\.f000$/);
assertProfile(recent.levels);

// Older Grid-4 point analyses remain available through NCEI's direct
// fileServer/full-file route and are decoded locally. NCSS is not the primary
// transport for this path.
const historicalAnalysisTime = "2017-05-09T12:00:00Z";
const historical = await service.getHistoricalProfile({
  ...POINT,
  analysisTime: historicalAnalysisTime,
  variables: [...VARIABLES],
  pressureLevelsHpa: [...PRESSURE_LEVELS],
});

assert.equal(historical.source.provider, "NOAA NCEI");
assert.equal(historical.source.access, "ncei_thredds_fileserver");
assert.match(historical.source.dataset, /gfsanl_4_20170509_1200_000\.grb2$/);
assertProfile(historical.levels);

const verification = await new HistoricalForecastVerificationService().verify({
  ...POINT,
  validTime: recentAnalysisTime,
  leadHours: 12,
  variables: ["temperature"],
  pressureLevelsHpa: [850],
});
assert.equal(verification.source.forecast.provider, "NOAA AWS Open Data");
assert.equal(verification.source.forecast.access, "s3_range");
assert.equal(verification.source.reference.provider, "NOAA AWS Open Data");
assert.equal(verification.source.reference.access, "s3_range");
assert.match(verification.forecast.dataset, /gfs\.t[0-9]{2}z\.pgrb2\.0p50\.f012$/);
assert.match(verification.analysis.dataset, /gfs\.t00z\.pgrb2\.0p50\.f000$/);
assert.equal(verification.source.forecast.dataset, verification.forecast.dataset);
assert.equal(verification.source.reference.dataset, verification.analysis.dataset);
assert.equal(verification.pressureLevels[0]?.changes[0]?.field, "temperatureC");
assert(Number.isFinite(verification.pressureLevels[0]?.changes[0]?.delta));

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  contract: "gfs_analysis_routing",
  recent: {
    analysisTime: recent.analysisTime,
    source: recent.source,
  },
  historical: {
    analysisTime: historical.analysisTime,
    source: historical.source,
  },
  verify: {
    validTime: verification.validTime,
    forecastRun: verification.forecastRun,
    forecastDataset: verification.forecast.dataset,
    analysisDataset: verification.analysis.dataset,
    source: verification.source,
  },
}, null, 2));

function recentUtcCycle(daysAgo: number): string {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysAgo,
    0,
    0,
    0,
    0,
  )).toISOString();
}

function assertProfile(levels: ReadonlyArray<{
  pressureHpa: number;
  temperatureC?: number | undefined;
  relativeHumidityPct?: number | undefined;
  windSpeedMs?: number | undefined;
  geopotentialHeightGpm?: number | undefined;
}>): void {
  assert.deepEqual(levels.map((level) => level.pressureHpa), [...PRESSURE_LEVELS]);
  for (const level of levels) {
    assert(Number.isFinite(level.temperatureC));
    assert(Number.isFinite(level.relativeHumidityPct));
    assert(Number.isFinite(level.windSpeedMs));
    assert(Number.isFinite(level.geopotentialHeightGpm));
  }
}
