import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";

const service = new UnifiedAtmosphereQueryService();
const result = await service.query({
  dataset: "gefs",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: "2017-03-14T12:00:00Z" },
  selection: { fields: ["temperature_2m"] },
  forecast: {
    kind: "reforecast",
    run: "2017-03-14T00:00:00Z",
  },
  ensemble: {
    members: ["c00", "p01", "p02", "p03", "p04"],
    quantiles: [0.1, 0.5, 0.9],
    includeMembers: true,
  },
});

assert.equal(result.dataset, "gefs");
assert.equal(result.internalDatasetId, "gefs_v12_reforecast");
assert.equal(result.kind, "ensemble");
assert.equal(result.role, "forecast");

const reforecast = result.result as any;
assert.equal(reforecast.model, "gefs_v12_reforecast");
assert.equal(reforecast.run, "2017-03-14T00:00:00.000Z");
assert.equal(reforecast.validTime, "2017-03-14T12:00:00.000Z");
assert.equal(reforecast.forecastHour, 12);
assert.deepEqual(reforecast.selection.members, ["c00", "p01", "p02", "p03", "p04"]);
assert.equal(reforecast.fieldSummaries.length, 1);
assert.equal(reforecast.fieldSummaries[0].field, "temperature_2m");
assert.equal(reforecast.fieldSummaries[0].outputs[0].aggregation, "numeric_distribution");
assert.equal(reforecast.fieldSummaries[0].outputs[0].distribution.memberCount, 5);
assert(Number.isFinite(reforecast.fieldSummaries[0].outputs[0].distribution.mean));
assert.equal(reforecast.members.length, 5);
assert.equal(reforecast.source.provider, "NOAA AWS Open Data");
assert.equal(reforecast.source.access, "s3_range");
assert.equal(reforecast.source.archiveType, "reforecast");
assert.equal(reforecast.source.dataset, "GEFSv12/reforecast");
assert.equal(reforecast.source.leadBlock, "Days:1-10");
assert.equal(reforecast.source.horizontalGridDegrees, 0.25);

console.log(JSON.stringify({
  dataset: result.dataset,
  internalDatasetId: result.internalDatasetId,
  run: reforecast.run,
  validTime: reforecast.validTime,
  forecastHour: reforecast.forecastHour,
  members: reforecast.selection.members,
  temperature2m: reforecast.fieldSummaries[0],
  source: reforecast.source,
}, null, 2));
