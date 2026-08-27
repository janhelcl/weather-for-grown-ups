import assert from "node:assert/strict";
import { UnifiedForecastVerificationService } from "../src/core/unified-specialized-api.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const now = new Date();
const targetDate = new Date(now.getTime() - 3 * DAY_MS);
const validTime = new Date(Date.UTC(
  targetDate.getUTCFullYear(),
  targetDate.getUTCMonth(),
  targetDate.getUTCDate(),
  12,
  0,
  0,
  0,
));

const service = new UnifiedForecastVerificationService();
const result = await service.verify({
  referenceDataset: "igra",
  geometry: { type: "point", latitude: 50.0078, longitude: 14.4469 },
  time: { at: validTime.toISOString() },
  leadHours: 48,
  variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
  pressureLevelsHpa: [850, 700, 500],
  stationId: "EZM00011520",
  maxStationDistanceKm: 25,
  gfsGrid: "0p25",
});

assert.deepEqual(result.datasets, ["gfs", "igra"]);
const verification = result.result as any;
assert.equal(verification.model, "gfs_igra_verification");
assert.equal(verification.station.id, "EZM00011520");
assert.equal(verification.comparison, "observation_minus_forecast");
assert(verification.matchedPressureLevelsHpa.length > 0, "No requested pressure level matched IGRA");
assert(
  verification.pressureLevels.some((level: any) => level.changes.length > 0),
  "IGRA verification produced no comparable observed fields",
);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  validTime: validTime.toISOString(),
  station: verification.station,
  gfsGrid: verification.gfsGrid,
  matchedPressureLevelsHpa: verification.matchedPressureLevelsHpa,
  missingPressureLevelsHpa: verification.missingPressureLevelsHpa,
  pressureLevels: verification.pressureLevels,
}, null, 2));
