import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import { aigfsValidTime, floorToAigfsCycle } from "../src/sources/aigfs.js";

const safelyPublishedRun = floorToAigfsCycle(new Date(Date.now() - 18 * 3_600_000));
const validTime = aigfsValidTime(safelyPublishedRun, 6);

const result = await new UnifiedAtmosphereQueryService().query({
  dataset: "aigefs",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: validTime.toISOString() },
  selection: {
    variables: ["temperature", "wind"],
    pressureLevelsHpa: [850],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
  ensemble: {
    members: ["000", "001"],
    quantiles: [0.1, 0.5, 0.9],
  },
});

assert.equal(result.dataset, "aigefs");
assert.equal(result.internalDatasetId, "aigefs_0p25");
assert.equal(result.kind, "ensemble");
assert.equal(result.role, "forecast");

const ensemble = result.result as any;
assert.equal(ensemble.model, "aigefs_0p25");
assert.equal(ensemble.validTime, validTime.toISOString());
assert.deepEqual(ensemble.selection.members, ["000", "001"]);
assert.deepEqual(ensemble.selection.quantiles, [0.1, 0.5, 0.9]);

const temperature = ensemble.pressureSummaries.find(
  (item: any) => item.variable === "temperature" && item.pressureLevelHpa === 850,
);
assert(temperature, "missing AIGEFS temperature summary");
assert.equal(temperature.distribution.memberCount, 2);
assert(Number.isFinite(temperature.distribution.mean));

const windSpeed = ensemble.pressureSummaries.find(
  (item: any) => item.variable === "wind"
    && item.pressureLevelHpa === 850
    && item.field === "windSpeedMs",
);
assert(windSpeed, "missing AIGEFS wind-speed summary");
assert.equal(windSpeed.distribution.memberCount, 2);
assert(Number.isFinite(windSpeed.distribution.populationStdDev));

const windDirection = ensemble.pressureSummaries.find(
  (item: any) => item.variable === "wind"
    && item.pressureLevelHpa === 850
    && item.field === "windDirectionDeg",
);
assert(windDirection, "missing AIGEFS wind-direction summary");
assert.equal(windDirection.aggregation, "circular_direction");
assert.equal(windDirection.memberCount, 2);

assert.equal(ensemble.source.provider, "NOAA NOMADS");
assert.equal(ensemble.source.access, "nomads_range");
assert.equal(ensemble.source.horizontalGridDegrees, 0.25);
assert.equal(ensemble.source.memberPopulation, "000-030");

console.log(JSON.stringify({
  dataset: result.dataset,
  internalDatasetId: result.internalDatasetId,
  run: ensemble.run,
  validTime: ensemble.validTime,
  members: ensemble.selection.members,
  pressureSummaries: ensemble.pressureSummaries,
  source: ensemble.source,
}, null, 2));
