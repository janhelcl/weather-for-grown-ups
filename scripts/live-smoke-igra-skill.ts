import assert from "node:assert/strict";
import { UnifiedForecastVerificationService } from "../src/core/unified-specialized-api.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const now = new Date();
const endDate = new Date(now.getTime() - 3 * DAY_MS);
const startDate = new Date(now.getTime() - 4 * DAY_MS);
const startTime = new Date(Date.UTC(
  startDate.getUTCFullYear(),
  startDate.getUTCMonth(),
  startDate.getUTCDate(),
  12,
  0,
  0,
  0,
));
const endTime = new Date(Date.UTC(
  endDate.getUTCFullYear(),
  endDate.getUTCMonth(),
  endDate.getUTCDate(),
  12,
  0,
  0,
  0,
));

const service = new UnifiedForecastVerificationService();
const result = await service.verify({
  referenceDataset: "igra",
  geometry: { type: "point", latitude: 50.0078, longitude: 14.4469 },
  time: {
    from: startTime.toISOString(),
    to: endTime.toISOString(),
    hoursUtc: [12],
    maxValidTimes: 2,
  },
  leadHours: [24, 48],
  variables: ["temperature", "wind"],
  pressureLevelsHpa: [850, 700],
  stationId: "EZM00011520",
  maxStationDistanceKm: 25,
  gfsGrid: "0p25",
});

assert.deepEqual(result.datasets, ["gfs", "igra"]);
const skill = result.result as any;
assert.equal(skill.model, "gfs_igra_skill_summary");
assert.equal(skill.comparison, "observation_minus_forecast");
assert.equal(skill.period.sampling, "evenly_spaced_nominal_times");
assert.equal(skill.availability.requestedEvaluations, 4);
assert(skill.availability.successfulEvaluations > 0, "No live IGRA skill evaluation succeeded");
assert(skill.statistics.length > 0, "Live IGRA skill summary produced no statistics");
assert(
  skill.statistics.every((statistic: any) => statistic.count > 0),
  "Skill statistics must expose positive sample counts",
);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  period: skill.period,
  leadHours: skill.leadHours,
  availability: skill.availability,
  evaluations: skill.evaluations,
  statistics: skill.statistics,
}, null, 2));
