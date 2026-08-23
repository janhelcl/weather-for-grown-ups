import assert from "node:assert/strict";
import { AreaSummaryService } from "../src/core/area-summary.js";
import { LatestRunResolver } from "../src/core/latest-run.js";

const HOUR_MS = 3_600_000;
const latestRunResolver = new LatestRunResolver();
const run = await latestRunResolver.resolveLatestRun();
const validTime = new Date(run.getTime() + 6 * HOUR_MS);
const service = new AreaSummaryService({ latestRunProvider: latestRunResolver });

const result = await service.summarize({
  westLongitude: 13,
  eastLongitude: 15,
  southLatitude: 49.5,
  northLatitude: 50.5,
  run: run.toISOString(),
  validTime: validTime.toISOString(),
  field: "temperature_2m",
  percentiles: [10, 50, 90],
  thresholds: [{ operator: "gte", value: 0 }],
  includeExtremaLocations: true,
});

assert.equal(result.model, "gfs_0p25");
assert.equal(result.run, run.toISOString());
assert.equal(result.forecastHour, 6);
assert.equal(result.field?.id, "temperature_2m");
assert.equal(result.field?.output.unit, "degC");
assert.deepEqual(result.field?.temporal, { type: "instantaneous" });
assert.equal(result.source.provider, "NOAA NOMADS");
assert.equal(result.source.access, "nomads_grib_filter");
assert(result.statistics.definedGridPoints > 0);
assert.equal(result.distribution?.percentiles?.length, 3);
const threshold = result.distribution?.thresholdFractions?.[0];
assert(threshold);
assert(threshold.fraction >= 0 && threshold.fraction <= 1);
const extrema = result.distribution?.extrema;
assert(extrema);
for (const extremum of [extrema.min, extrema.max]) {
  assert(extremum.gridPoint.latitude >= 49.25 && extremum.gridPoint.latitude <= 50.75);
  assert(extremum.gridPoint.longitude >= 12.75 && extremum.gridPoint.longitude <= 15.25);
  assert(extremum.tiedGridPoints >= 1);
}

console.log(JSON.stringify({
  run: run.toISOString(),
  validTime: validTime.toISOString(),
  field: result.field,
  statistics: result.statistics,
  distribution: result.distribution,
  source: result.source,
}, null, 2));
