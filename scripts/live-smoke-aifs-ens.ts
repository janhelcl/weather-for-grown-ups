import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import { aifsValidTime, latestAifsCycleAtOrBefore } from "../src/core/aifs-time.js";

const safelyPublishedRun = latestAifsCycleAtOrBefore(
  new Date(Date.now() - 18 * 3_600_000),
);
const validTime = aifsValidTime(safelyPublishedRun, 6);

const result = await new UnifiedAtmosphereQueryService().query({
  dataset: "aifs-ens",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: validTime.toISOString() },
  selection: {
    variables: ["temperature", "wind"],
    pressureLevelsHpa: [850],
    fields: ["temperature_2m"],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
  ensemble: {
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
});

assert.equal(result.dataset, "aifs-ens");
assert.equal(result.internalDatasetId, "aifs_ens_0p25");
assert.equal(result.kind, "ensemble");
assert.equal(result.role, "forecast");

const ensemble = result.result as any;
assert.equal(ensemble.model, "aifs_ens_0p25");
assert.equal(ensemble.validTime, validTime.toISOString());
assert.equal(ensemble.forecastHour, 6);
assert.deepEqual(ensemble.selection.members, ["c00", "p01"]);
assert.equal(ensemble.source.provider, "ECMWF Open Data");
assert.equal(ensemble.source.access, "indexed_http_range");
assert.equal(ensemble.source.product, "aifs_ens_0p25_enfo_cf_pf");
assert.equal(ensemble.source.horizontalGridDegrees, 0.25);
assert.equal(ensemble.pressureSummaries.length > 0, true);
assert.equal(ensemble.fieldSummaries.length, 1);

console.log(JSON.stringify({
  dataset: result.dataset,
  internalDatasetId: result.internalDatasetId,
  run: ensemble.run,
  validTime: ensemble.validTime,
  selection: ensemble.selection,
  pressureSummaries: ensemble.pressureSummaries,
  fieldSummaries: ensemble.fieldSummaries,
  source: ensemble.source,
}, null, 2));
