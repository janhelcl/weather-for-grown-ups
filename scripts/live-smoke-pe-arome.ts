import assert from "node:assert/strict";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import { floorToPeAromeCycle, peAromeValidTime } from "../src/sources/pe-arome.js";

if (!process.env.WFG_METEO_FRANCE_TOKEN) {
  throw new Error("WFG_METEO_FRANCE_TOKEN is required for the PE-AROME live smoke");
}
if (!process.env.WFG_PEAROME_WCS_URL_TEMPLATE && !process.env.WFG_PEAROME_WCS_ENDPOINTS) {
  throw new Error(
    "WFG_PEAROME_WCS_URL_TEMPLATE or WFG_PEAROME_WCS_ENDPOINTS is required for the PE-AROME live smoke",
  );
}

// Stay behind the publication edge while remaining comfortably inside the
// provider's short realtime retention window.
const safelyPublishedRun = floorToPeAromeCycle(new Date(Date.now() - 12 * 3_600_000));
const validTime = peAromeValidTime(safelyPublishedRun, 6);

const result = await new UnifiedAtmosphereQueryService().query({
  dataset: "pe-arome",
  geometry: { type: "point", latitude: 48.8566, longitude: 2.3522 },
  time: { at: validTime.toISOString() },
  selection: {
    fields: ["temperature_2m", "wind_10m"],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
  ensemble: {
    members: ["c00", "p01"],
    quantiles: [0.1, 0.5, 0.9],
    includeMembers: true,
  },
});

assert.equal(result.dataset, "pe-arome");
assert.equal(result.internalDatasetId, "pe_arome_0p025");
assert.equal(result.kind, "ensemble");
assert.equal(result.role, "forecast");

const point = result.result as any;
assert.equal(point.model, "pe_arome_0p025");
assert.equal(point.validTime, validTime.toISOString());
assert.equal(point.forecastHour, 6);
assert.deepEqual(point.selection.members, ["c00", "p01"]);
assert.equal(point.members.length, 2);

const temperature = point.fieldSummaries.find((item: any) => item.field === "temperature_2m");
const wind = point.fieldSummaries.find((item: any) => item.field === "wind_10m");
assert(temperature, "missing PE-AROME temperature_2m field summary");
assert(wind, "missing PE-AROME wind_10m field summary");
assert(Number.isFinite(
  temperature.outputs.find((item: any) => item.field === "temperatureC").distribution.mean,
));
assert(Number.isFinite(
  wind.outputs.find((item: any) => item.field === "windSpeedMs").distribution.mean,
));
assert.equal(point.source.provider, "Météo-France Public API");
assert.equal(point.source.access, "meteo_france_wcs");
assert.equal(point.source.memberCount, 2);
assert.equal(point.source.samplingGrid.resolutionDegrees, 0.025);

console.log(JSON.stringify({
  dataset: result.dataset,
  internalDatasetId: result.internalDatasetId,
  run: point.run,
  validTime: point.validTime,
  selection: point.selection,
  fieldSummaries: point.fieldSummaries,
  source: point.source,
}, null, 2));
