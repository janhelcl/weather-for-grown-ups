import { tmpdir } from "node:os";
import { join } from "node:path";
import { GfsS3SubsetCache } from "../src/cache/s3-subset-cache.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type RawNonIsobaricFieldDefinition,
} from "../src/catalog/non-isobaric-fields.js";
import { LatestRunResolver } from "../src/core/latest-run.js";
import { readGribMessages } from "../src/grib/gribberish-runtime.js";

const run = await new LatestRunResolver().resolveLatestRun();
const forecastHour = 6;
const fields = [
  NON_ISOBARIC_FIELD_CATALOG.total_precipitation,
  NON_ISOBARIC_FIELD_CATALOG.low_cloud_cover_average,
] as RawNonIsobaricFieldDefinition[];
const cache = new GfsS3SubsetCache(join(tmpdir(), `wfg-stat-probe-${process.pid}`));
const subset = await cache.fetch({
  run,
  forecastHour,
  latitude: 50.08,
  longitude: 14.43,
  variables: [],
  pressureLevelsHpa: [],
  fields,
});
const messages = await readGribMessages(subset.path);
console.log(JSON.stringify(messages.map((message) => ({
  key: message.key,
  varAbbrev: message.varAbbrev,
  referenceDate: message.referenceDate.toISOString(),
  forecastDate: message.forecastDate.toISOString(),
  forecastEndDate: message.forecastEndDate?.toISOString() ?? null,
  gridShape: message.gridShape,
})), null, 2));
