import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import { aigfsValidTime, floorToAigfsCycle } from "../src/sources/aigfs.js";

const safelyPublishedRun = floorToAigfsCycle(new Date(Date.now() - 24 * 3_600_000));
const validTime = aigfsValidTime(safelyPublishedRun, 6);

const result = await new UnifiedAtmosphereQueryService().query({
  dataset: "hgefs",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: validTime.toISOString() },
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850],
    fields: ["temperature_2m"],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
  ensemble: {
    members: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
    quantiles: [0.5],
  },
});

assert.equal(result.dataset, "hgefs");
assert.equal(result.internalDatasetId, "hgefs_0p25");
assert.equal(result.kind, "ensemble");
assert.equal(result.role, "forecast");

const ensemble = result.result as any;
assert.equal(ensemble.model, "hgefs_0p25");
assert.equal(ensemble.run, safelyPublishedRun.toISOString());
assert.equal(ensemble.validTime, validTime.toISOString());
assert.equal(ensemble.forecastHour, 6);
assert.deepEqual(
  ensemble.selection.members,
  ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
);
assert.equal(ensemble.composition.kind, "hybrid");
assert.equal(ensemble.composition.totalMemberCount, 4);
assert.deepEqual(
  ensemble.composition.populations.map((population: any) => ({
    id: population.id,
    modelClass: population.modelClass,
    memberCount: population.memberCount,
  })),
  [
    { id: "gefs", modelClass: "physics", memberCount: 2 },
    { id: "aigefs", modelClass: "ai", memberCount: 2 },
  ],
);
assert.equal(ensemble.gridPoints.gefs !== undefined, true);
assert.equal(ensemble.gridPoints.aigefs !== undefined, true);
assert.equal(ensemble.source.provider, "NOAA");
assert.equal(ensemble.source.access, "constituent_open_data_composition");
assert.equal(ensemble.source.methodology, "member_first_gefs_plus_aigefs");
assert.equal(ensemble.pressureSummaries.length, 1);
assert.equal(ensemble.pressureSummaries[0].distribution.memberCount, 4);
assert.equal(ensemble.fieldSummaries.length, 1);
assert.equal(ensemble.fieldSummaries[0].outputs[0].distribution.memberCount, 4);

console.log(JSON.stringify({
  dataset: result.dataset,
  internalDatasetId: result.internalDatasetId,
  run: ensemble.run,
  validTime: ensemble.validTime,
  gridPoints: ensemble.gridPoints,
  selection: ensemble.selection,
  pressureSummaries: ensemble.pressureSummaries,
  fieldSummaries: ensemble.fieldSummaries,
  composition: ensemble.composition,
  source: ensemble.source,
}, null, 2));
