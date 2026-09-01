import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import { aromeValidTime, floorToAromeCycle } from "../src/sources/arome.js";

// Stay comfortably behind the publication edge while remaining inside the
// short Open Data retention window.
const safelyPublishedRun = floorToAromeCycle(new Date(Date.now() - 12 * 3_600_000));
const validTime = aromeValidTime(safelyPublishedRun, 6);

const result = await new UnifiedAtmosphereQueryService().query({
  dataset: "arome",
  geometry: { type: "point", latitude: 48.8566, longitude: 2.3522 },
  time: { at: validTime.toISOString() },
  selection: {
    fields: ["temperature_2m", "relative_humidity_2m", "wind_10m"],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
});

assert.equal(result.dataset, "arome");
assert.equal(result.internalDatasetId, "arome_0p01");
assert.equal(result.kind, "deterministic");
assert.equal(result.role, "forecast");

const point = result.result as any;
assert.equal(point.model, "arome_0p01");
assert.equal(point.validTime, validTime.toISOString());
assert.equal(point.forecastHour, 6);
assert.deepEqual(point.levels, []);
for (const field of ["temperature_2m", "relative_humidity_2m", "wind_10m"]) {
  assert(point.fields.some((item: any) => item.id === field), `missing AROME field ${field}`);
}
assert(Number.isFinite(
  point.fields.find((item: any) => item.id === "temperature_2m").values.temperatureC,
));
assert(Number.isFinite(
  point.fields.find((item: any) => item.id === "relative_humidity_2m").values.relativeHumidityPct,
));
assert(Number.isFinite(
  point.fields.find((item: any) => item.id === "wind_10m").values.windSpeedMs,
));
assert.equal(point.source.provider, "Météo-France Open Data");
assert.equal(point.source.access, "meteo_france_open_data");
assert.equal(point.source.nativeGrid.type, "lambert_conformal");
assert.equal(point.source.nativeGrid.nominalResolutionKm, 1.3);
assert.equal(point.source.productGrid.type, "regular_latlon");
assert.equal(point.source.productGrid.resolutionDegrees, 0.01);
assert.equal(point.source.productGrid.product, "EURW1S100");

console.log(JSON.stringify({
  dataset: result.dataset,
  internalDatasetId: result.internalDatasetId,
  run: point.run,
  validTime: point.validTime,
  gridPoint: point.gridPoint,
  fields: point.fields,
  source: point.source,
}, null, 2));
