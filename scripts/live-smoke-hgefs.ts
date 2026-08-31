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
    variables: ["temperature", "wind"],
    pressureLevelsHpa: [850],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
  ensemble: {
    members: ["gefs:c00", "aigefs:c00"],
    quantiles: [0.5],
    includeMembers: true,
  },
});

assert.equal(result.dataset, "hgefs");
assert.equal(result.internalDatasetId, "hgefs_0p25");
assert.equal(result.kind, "ensemble");
assert.equal(result.role, "forecast");

const ensemble = result.result as any;
assert.equal(ensemble.model, "hgefs_0p25");
assert.equal(ensemble.validTime, validTime.toISOString());
assert.equal(ensemble.forecastHour, 6);
assert.deepEqual(ensemble.selection.members, ["gefs:c00", "aigefs:c00"]);
assert.deepEqual(ensemble.selection.populations, [
  { population: "gefs", modelClass: "physics", selectedMemberCount: 1 },
  { population: "aigefs", modelClass: "ai", selectedMemberCount: 1 },
]);
assert.equal(ensemble.source.provider, "NOAA");
assert.equal(ensemble.source.access, "constituent_member_feeds");
assert.equal(ensemble.source.memberCount, 2);
assert.equal(ensemble.source.constituents.length, 2);
assert.equal(ensemble.constituentGridPoints.length, 2);
assert.equal(ensemble.members.length, 2);
assert.equal(
  ensemble.pressureSummaries.every((summary: any) =>
    summary.aggregation === "circular_direction"
      ? Number.isFinite(summary.meanDirectionDeg)
      : Number.isFinite(summary.distribution.mean)),
  true,
);

console.log(JSON.stringify({
  dataset: result.dataset,
  internalDatasetId: result.internalDatasetId,
  run: ensemble.run,
  validTime: ensemble.validTime,
  selection: ensemble.selection,
  constituentGridPoints: ensemble.constituentGridPoints,
  pressureSummaries: ensemble.pressureSummaries,
  source: ensemble.source,
}, null, 2));
