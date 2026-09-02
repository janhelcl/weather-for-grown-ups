import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import { floorToIconD2Cycle, iconD2ValidTime } from "../src/sources/icon-d2.js";

const safelyPublishedRun = floorToIconD2Cycle(new Date(Date.now() - 12 * 3_600_000));
const validTime = iconD2ValidTime(safelyPublishedRun, 6);

const result = await new UnifiedAtmosphereQueryService().query({
  dataset: "icon-d2",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: validTime.toISOString() },
  selection: {
    variables: ["temperature", "wind", "relative_humidity", "geopotential_height"],
    pressureLevelsHpa: [850],
    fields: [
      "temperature_2m",
      "wind_10m",
      "mean_sea_level_pressure",
      "convective_rain",
      "convective_snow",
      "visibility",
      "cloud_ceiling_height_msl",
      "column_maximum_reflectivity",
    ],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
});

assert.equal(result.dataset, "icon-d2");
assert.equal(result.internalDatasetId, "icon_d2_0p02");
assert.equal(result.kind, "deterministic");
assert.equal(result.role, "forecast");

const profile = result.result as any;
assert.equal(profile.model, "icon_d2_0p02");
assert.equal(profile.validTime, validTime.toISOString());
assert.equal(profile.forecastHour, 6);
assert.equal(profile.levels.length, 1);
assert(Number.isFinite(profile.levels[0].temperatureC));
assert(Number.isFinite(profile.levels[0].windSpeedMs));
assert(Number.isFinite(profile.levels[0].relativeHumidityPct));
assert(Number.isFinite(profile.levels[0].geopotentialHeightGpm));
for (const field of [
  "temperature_2m",
  "wind_10m",
  "mean_sea_level_pressure",
  "convective_rain",
  "convective_snow",
  "visibility",
  "cloud_ceiling_height_msl",
  "column_maximum_reflectivity",
]) {
  assert(profile.fields.some((item: any) => item.id === field), `missing ICON-D2 field ${field}`);
}
const reflectivity = profile.fields.find(
  (item: any) => item.id === "column_maximum_reflectivity",
);
assert(Number.isFinite(reflectivity.values.columnMaximumReflectivityFactorMm6M3));
assert.deepEqual(reflectivity.level, { type: "named_layer", id: "entire_atmosphere" });
assert.deepEqual(reflectivity.temporal, { type: "instantaneous" });

const visibility = profile.fields.find((item: any) => item.id === "visibility");
assert(Number.isFinite(visibility.values.visibilityM));
assert.deepEqual(visibility.level, { type: "surface" });
assert.deepEqual(visibility.temporal, { type: "instantaneous" });

const ceiling = profile.fields.find(
  (item: any) => item.id === "cloud_ceiling_height_msl",
);
assert(Number.isFinite(ceiling.values.cloudCeilingHeightMslM));
assert.deepEqual(ceiling.level, { type: "named_level", id: "cloud_ceiling" });
assert.deepEqual(ceiling.temporal, { type: "instantaneous" });

for (const [id, output] of [
  ["convective_rain", "convectiveRainMm"],
  ["convective_snow", "convectiveSnowWaterEquivalentMm"],
] as const) {
  const precipitation = profile.fields.find((item: any) => item.id === id);
  assert(Number.isFinite(precipitation.values[output]));
  assert.deepEqual(precipitation.level, { type: "surface" });
  assert.equal(precipitation.temporal.type, "accumulation");
  assert.equal(precipitation.temporal.startForecastHour, 0);
  assert.equal(precipitation.temporal.endForecastHour, 6);
}

assert.equal(profile.source.provider, "DWD Open Data");
assert.equal(profile.source.access, "dwd_open_data");
assert.equal(profile.source.productGrid.type, "regular_latlon");
assert.equal(profile.source.productGrid.resolutionDegrees, 0.02);

console.log(JSON.stringify({
  dataset: result.dataset,
  internalDatasetId: result.internalDatasetId,
  run: profile.run,
  validTime: profile.validTime,
  gridPoint: profile.gridPoint,
  levels: profile.levels,
  fields: profile.fields,
  source: profile.source,
}, null, 2));
