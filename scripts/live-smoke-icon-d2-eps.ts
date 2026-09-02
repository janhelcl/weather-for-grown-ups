import assert from "node:assert/strict";

import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import {
  floorToIconD2EpsCycle,
  iconD2EpsValidTime,
} from "../src/sources/icon-d2-eps.js";

const safelyPublishedRun = floorToIconD2EpsCycle(
  new Date(Date.now() - 12 * 3_600_000),
);
const validTime = iconD2EpsValidTime(safelyPublishedRun, 6);

const result = await new UnifiedAtmosphereQueryService().query({
  dataset: "icon-d2-eps",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: validTime.toISOString() },
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850],
    fields: [
      "mean_layer_cape",
      "mean_layer_cin",
      "updraft_helicity_max_2_8km",
      "convective_rain",
      "convective_snow",
      "visibility",
      "cloud_ceiling_height_msl",
      "shallow_convective_cloud_base_height_msl",
      "shallow_convective_cloud_top_height_msl",
      "column_maximum_reflectivity",
    ],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
  ensemble: {
    members: ["p01", "p02"],
    quantiles: [0.5],
  },
});

assert.equal(result.dataset, "icon-d2-eps");
assert.equal(result.internalDatasetId, "icon_d2_eps_2p1km");
assert.equal(result.kind, "ensemble");
assert.equal(result.role, "forecast");

const ensemble = result.result as any;
assert.equal(ensemble.model, "icon_d2_eps_2p1km");
assert.equal(ensemble.validTime, validTime.toISOString());
assert.equal(ensemble.forecastHour, 6);
assert.deepEqual(ensemble.selection.members, ["p01", "p02"]);
const temperature = ensemble.pressureSummaries.find(
  (summary: any) => summary.pressureLevelHpa === 850
    && summary.field === "temperatureC",
);
assert(temperature, "missing ICON-D2-EPS temperature distribution");
assert.equal(temperature.distribution.memberCount, 2);
assert(Number.isFinite(temperature.distribution.mean));
for (const [id, output] of [
  ["mean_layer_cape", "meanLayerCapeJkg"],
  ["mean_layer_cin", "meanLayerCinJkg"],
] as const) {
  const ingredient = ensemble.fieldSummaries.find(
    (summary: any) => summary.field === id,
  );
  assert(ingredient, `missing ICON-D2-EPS ${id} distribution`);
  assert.deepEqual(ingredient.level, { type: "named_layer", id: "mean_layer" });
  assert.deepEqual(ingredient.temporal, { type: "instantaneous" });
  const outputSummary = ingredient.outputs.find((item: any) => item.field === output);
  assert(outputSummary, `missing ICON-D2-EPS ${id} output`);
  assert.equal(outputSummary.distribution.memberCount, 2);
  assert(Number.isFinite(outputSummary.distribution.mean));
}

const updraftHelicity = ensemble.fieldSummaries.find(
  (summary: any) => summary.field === "updraft_helicity_max_2_8km",
);
assert(updraftHelicity, "missing ICON-D2-EPS updraft helicity distribution");
assert.deepEqual(updraftHelicity.level, {
  type: "named_layer",
  id: "height_layer_2_8km_msl",
});
assert.equal(updraftHelicity.temporal.type, "maximum");
assert.equal(updraftHelicity.temporal.startForecastHour, 5);
assert.equal(updraftHelicity.temporal.endForecastHour, 6);
const updraftHelicityOutput = updraftHelicity.outputs.find(
  (output: any) => output.field === "updraftHelicityM2S2",
);
assert(updraftHelicityOutput, "missing ICON-D2-EPS updraft helicity output");
assert.equal(updraftHelicityOutput.distribution.memberCount, 2);
assert(Number.isFinite(updraftHelicityOutput.distribution.mean));

const reflectivity = ensemble.fieldSummaries.find(
  (summary: any) => summary.field === "column_maximum_reflectivity",
);
assert(reflectivity, "missing ICON-D2-EPS reflectivity distribution");
assert.deepEqual(reflectivity.level, { type: "named_layer", id: "entire_atmosphere" });
assert.deepEqual(reflectivity.temporal, { type: "instantaneous" });
const reflectivityOutput = reflectivity.outputs.find(
  (output: any) => output.field === "columnMaximumReflectivityFactorMm6M3",
);
assert(reflectivityOutput, "missing ICON-D2-EPS reflectivity output");
assert.equal(reflectivityOutput.distribution.memberCount, 2);
assert(Number.isFinite(reflectivityOutput.distribution.mean));

for (const [id, output, level] of [
  ["visibility", "visibilityM", { type: "surface" }],
  [
    "cloud_ceiling_height_msl",
    "cloudCeilingHeightMslM",
    { type: "named_level", id: "cloud_ceiling" },
  ],
] as const) {
  const aviation = ensemble.fieldSummaries.find(
    (summary: any) => summary.field === id,
  );
  assert(aviation, `missing ICON-D2-EPS ${id} distribution`);
  assert.deepEqual(aviation.level, level);
  assert.deepEqual(aviation.temporal, { type: "instantaneous" });
  const outputSummary = aviation.outputs.find((item: any) => item.field === output);
  assert(outputSummary, `missing ICON-D2-EPS ${id} output`);
  assert.equal(outputSummary.distribution.memberCount, 2);
  assert(Number.isFinite(outputSummary.distribution.mean));
}

for (const [id, output] of [
  ["shallow_convective_cloud_base_height_msl", "shallowConvectiveCloudBaseHeightMslM"],
  ["shallow_convective_cloud_top_height_msl", "shallowConvectiveCloudTopHeightMslM"],
] as const) {
  const height = ensemble.fieldSummaries.find(
    (summary: any) => summary.field === id,
  );
  assert(height, `missing ICON-D2-EPS ${id} distribution`);
  assert.deepEqual(height.level, { type: "named_level", id: "mean_sea_level" });
  assert.deepEqual(height.temporal, { type: "instantaneous" });
  const outputSummary = height.outputs.find((item: any) => item.field === output);
  assert(outputSummary, `missing ICON-D2-EPS ${id} output`);
  assert.equal(outputSummary.distribution.memberCount, 2);
  assert(Number.isFinite(outputSummary.distribution.mean));
}

for (const [id, output] of [
  ["convective_rain", "convectiveRainMm"],
  ["convective_snow", "convectiveSnowWaterEquivalentMm"],
] as const) {
  const precipitation = ensemble.fieldSummaries.find(
    (summary: any) => summary.field === id,
  );
  assert(precipitation, `missing ICON-D2-EPS ${id} distribution`);
  assert.deepEqual(precipitation.level, { type: "surface" });
  assert.equal(precipitation.temporal.type, "accumulation");
  assert.equal(precipitation.temporal.startForecastHour, 0);
  assert.equal(precipitation.temporal.endForecastHour, 6);
  const precipitationOutput = precipitation.outputs.find(
    (item: any) => item.field === output,
  );
  assert(precipitationOutput, `missing ICON-D2-EPS ${id} output`);
  assert.equal(precipitationOutput.distribution.memberCount, 2);
  assert(Number.isFinite(precipitationOutput.distribution.mean));
}

assert.equal(ensemble.source.provider, "DWD Open Data");
assert.equal(ensemble.source.access, "dwd_open_data");
assert.equal(ensemble.source.packaging, "all_members_grib2_bz2");
assert.equal(ensemble.source.nativeGrid.type, "icosahedral");
assert.equal(ensemble.source.memberCount, 2);

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
