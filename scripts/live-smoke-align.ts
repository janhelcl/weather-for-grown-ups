import assert from "node:assert/strict";
import { UnifiedAtmosphereAlignmentService } from "../src/core/unified-atmosphere-api.js";
import type { AlignAtmosphereResult, AlignedCell } from "../src/schema/unified-alignment.js";

/**
 * Live smoke for `align_atmosphere`: the same point × time × selection question
 * asked of heterogeneous sources, joined by canonical quantity and valid time.
 * Asserts provenance, canonical labels, inline per-source failures and that WFG
 * computes no differences.
 */

const service = new UnifiedAtmosphereAlignmentService();
const now = Date.now();
const cycleMs = 6 * 3_600_000;
const latestCycle = new Date(Math.floor((now - 8 * 3_600_000) / cycleMs) * cycleMs);
const previousCycle = new Date(latestCycle.getTime() - cycleMs);
const validTime = new Date(latestCycle.getTime() + 24 * 3_600_000);
const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

function cellOf(result: AlignAtmosphereResult, outputField: string, label: string, step = 0): AlignedCell {
  const quantity = result.quantities.find((candidate) => candidate.output.field === outputField);
  assert(quantity, `quantity ${outputField} present`);
  const column = result.sources.findIndex((source) => source.label === label);
  assert(column >= 0, `source ${label} present`);
  const cell = quantity.series[step]?.values[column];
  assert(cell, `cell ${outputField}/${label}/${step} present`);
  return cell;
}

// 1. Mixed deterministic / ensemble / regional fan-out, one valid time.
const mixed = await service.align({
  sources: [
    { dataset: "gfs" },
    { dataset: "gfs", forecast: { run: previousCycle.toISOString() } },
    { dataset: "ifs" },
    { dataset: "ifs-ens", ensemble: { members: ["p01", "p02", "p03"], quantiles: [0.5] } },
    { dataset: "icon-d2" },
    { dataset: "arome" }, // field-only dataset: must fail inline on the pressure selection
  ],
  geometry: point,
  time: { at: validTime.toISOString() },
  selection: { variables: ["temperature", "wind"], pressureLevelsHpa: [850], fields: ["temperature_2m"] },
});

assert.equal(mixed.operation, "align_atmosphere");
assert.equal(mixed.alignment.initialization, "independent");
assert.equal(mixed.alignment.spatial, "each_source_samples_its_own_native_grid_at_the_requested_coordinate_no_regridding");
assert.deepEqual(
  mixed.sources.map((source) => source.label),
  ["gfs@latest", `gfs@${previousCycle.toISOString()}`, "ifs", "ifs-ens", "icon-d2", "arome"],
);
assert.deepEqual(
  mixed.quantities.map((quantity) => quantity.output.field),
  ["temperatureC", "windSpeedMs", "windDirectionDeg", "temperatureC"],
);
assert.equal(mixed.quantities[2]?.output.deltaKind, "circular_degrees");
assert.equal(mixed.quantities[0]?.output.unit, "degC");

const arome = mixed.sources[5];
assert(arome?.status === "failed", "AROME must fail inline on a pressure selection");
assert.equal(arome.failure.code, "INVALID_REQUEST");
assert.equal(cellOf(mixed, "temperatureC", "arome").kind, "unavailable");

for (const label of ["gfs@latest", `gfs@${previousCycle.toISOString()}`, "ifs", "icon-d2"]) {
  const source = mixed.sources.find((candidate) => candidate.label === label);
  assert(source?.status === "ok", `${label} succeeded: ${JSON.stringify(source)}`);
  assert.equal(source.kind, "deterministic");
  assert(source.run, `${label} reports its run`);
  assert(source.gridPoint, `${label} reports its sampled grid point`);
  assert.equal(source.steps.length, 1);
  const cell = cellOf(mixed, "temperatureC", label);
  assert.equal(cell.kind, "value", `${label} 850 hPa temperature is a scalar`);
}
const previous = mixed.sources[1];
assert(previous?.status === "ok");
assert.equal(previous.run, previousCycle.toISOString());
assert.equal(mixed.alignment.sharedInitialization, false);

const ens = mixed.sources.find((candidate) => candidate.label === "ifs-ens");
assert(ens?.status === "ok", `ifs-ens succeeded: ${JSON.stringify(ens)}`);
assert.equal(ens.kind, "ensemble");
assert.equal(ens.memberCount, 3);
const ensTemperature = cellOf(mixed, "temperatureC", "ifs-ens");
assert.equal(ensTemperature.kind, "distribution");
assert.equal(ensTemperature.memberCount, 3);
assert.equal(ensTemperature.quantiles.length, 1);
const ensDirection = cellOf(mixed, "windDirectionDeg", "ifs-ens");
assert.equal(ensDirection.kind, "circular_direction");

// WFG hands back evidence only: no delta, difference or verdict fields anywhere.
const serialized = JSON.stringify(mixed).toLowerCase();
for (const forbidden of ['"delta"', "minus", "standardizeddifference", "rangeposition", '"verdict"']) {
  assert(!serialized.includes(forbidden), `result must not contain ${forbidden}`);
}

console.log(JSON.stringify({
  mixed: {
    validTime: validTime.toISOString(),
    runs: mixed.alignment.runs,
    sources: mixed.sources.map((source) => source.status === "ok"
      ? { label: source.label, kind: source.kind, run: source.run, gridPoint: source.gridPoint, memberCount: source.memberCount }
      : { label: source.label, failure: source.failure.code }),
    temperature850: mixed.quantities[0]?.series[0]?.values,
  },
}, null, 2));

// 2. Shared initialization: GFS and IFS pinned to the same cycle.
const shared = await service.align({
  sources: [
    { dataset: "gfs", forecast: { run: latestCycle.toISOString() } },
    { dataset: "ifs", forecast: { run: latestCycle.toISOString() } },
  ],
  geometry: point,
  time: { at: validTime.toISOString() },
  selection: { fields: ["temperature_2m", "wind_10m"] },
  alignment: { initialization: "shared" },
});
assert.equal(shared.alignment.sharedInitialization, true);
assert.equal(shared.alignment.runs.length, 2);
assert(shared.alignment.runs.every((entry) => entry.run === latestCycle.toISOString()));

// 3. Range with union valid times: GFS (3-hourly) against ICON-D2 (hourly).
const rangeStart = new Date(latestCycle.getTime() + 12 * 3_600_000);
const rangeEnd = new Date(rangeStart.getTime() + 6 * 3_600_000);
const range = await service.align({
  sources: [{ dataset: "gfs" }, { dataset: "icon-d2", label: "d2" }],
  geometry: point,
  time: { from: rangeStart.toISOString(), to: rangeEnd.toISOString() },
  selection: { fields: ["temperature_2m"] },
  alignment: { validTimes: "union" },
});
assert.equal(range.alignment.validTimes, "union");
const series = range.quantities[0]?.series ?? [];
assert(series.length >= 3, `union axis has at least three steps, got ${series.length}`);
const d2 = range.sources[1];
assert(d2?.status === "ok", `icon-d2 range succeeded: ${JSON.stringify(d2)}`);
assert(series.every((step) => step.comparable), "instantaneous fields are always comparable");
const gfsSampled = series.filter((step) => step.values[0]?.kind === "value").length;
const notSampled = series.filter((step) => step.values[0]?.kind === "unavailable" && step.values[0].reason === "valid_time_not_sampled").length;
assert(gfsSampled >= 2, "GFS contributes its native 3-hourly steps");
assert(gfsSampled + notSampled === series.length, "GFS cells are either sampled or explicitly not sampled");

const intersection = await service.align({
  sources: [{ dataset: "gfs" }, { dataset: "icon-d2", label: "d2" }],
  geometry: point,
  time: { from: rangeStart.toISOString(), to: rangeEnd.toISOString() },
  selection: { fields: ["temperature_2m"] },
});
const intersectionSeries = intersection.quantities[0]?.series ?? [];
assert.equal(intersectionSeries.length, gfsSampled, "intersection keeps only commonly sampled valid times");
assert(intersectionSeries.every((step) => step.values.every((cell) => cell.kind === "value")));

console.log(JSON.stringify({
  shared: { runs: shared.alignment.runs },
  range: {
    from: rangeStart.toISOString(),
    to: rangeEnd.toISOString(),
    unionSteps: series.map((step) => ({ validTime: step.validTime, cells: step.values.map((cell) => cell.kind) })),
    intersectionSteps: intersectionSeries.length,
  },
}, null, 2));
