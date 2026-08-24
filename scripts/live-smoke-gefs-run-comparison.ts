import assert from "node:assert/strict";
import { GefsRunComparisonService } from "../src/core/gefs-run-comparison.js";
import { latestGefsCycleAtOrBefore } from "../src/core/gefs-time.js";

const members = ["c00", "p01", "p02"] as const;
const validTime = latestGefsCycleAtOrBefore(new Date());
const service = new GefsRunComparisonService();

const result = await service.compareRuns({
  latitude: 50.08,
  longitude: 14.43,
  anchorRun: "latest",
  validTime: validTime.toISOString(),
  variable: "temperature",
  pressureLevelHpa: 850,
  members: [...members],
  quantiles: [0.1, 0.5, 0.9],
  thresholdGte: 0,
  cycles: 2,
});

assert.equal(result.model, "gefs_0p50");
assert.equal(result.validTime, validTime.toISOString());
assert.deepEqual(result.selection.members, members);
assert.deepEqual(result.selection.quantiles, [0.1, 0.5, 0.9]);
assert.equal(result.runs.length, 2);
assert.equal(result.comparisons.length, 1);
assert.equal(new Date(result.runs[1]!.run).getTime() - new Date(result.runs[0]!.run).getTime(), 6 * 3_600_000);
assert(result.runs.every((run) => run.summary.memberCount === members.length));
assert(result.runs.every((run) => Number.isFinite(run.summary.mean)));
assert(result.runs.every((run) => Number.isFinite(run.summary.populationStdDev)));
assert(result.runs.every((run) => run.summary.quantiles.length === 3));
assert(result.runs.every((run) => run.summary.threshold?.interpretation === "raw_member_fraction_not_calibrated_probability"));

const comparison = result.comparisons[0]!;
assert.equal(comparison.fromRun, result.runs[0]!.run);
assert.equal(comparison.toRun, result.runs[1]!.run);
assert(Number.isFinite(comparison.mean.delta));
assert(Number.isFinite(comparison.populationStdDev.delta));
assert.equal(comparison.quantiles.length, 3);
assert.equal(comparison.interpretation, "distribution_shift_between_model_cycles_not_member_trajectory");
assert(comparison.thresholdFraction);
assert(comparison.thresholdFraction.delta >= -1 && comparison.thresholdFraction.delta <= 1);
assert.equal(result.source.provider, "NOAA AWS Open Data");
assert.equal(result.source.access, "s3_range");
assert.equal(result.source.product, "pgrb2a_0p50");

console.log(JSON.stringify({
  validTime: result.validTime,
  anchorRun: result.anchorRun,
  selection: result.selection,
  runs: result.runs.map((run) => ({
    run: run.run,
    forecastHour: run.forecastHour,
    meanC: run.summary.mean,
    populationStdDevC: run.summary.populationStdDev,
    quantiles: run.summary.quantiles,
    fractionGte0C: run.summary.threshold?.fraction,
    allCacheHit: run.allCacheHit,
  })),
  transition: comparison,
}, null, 2));
