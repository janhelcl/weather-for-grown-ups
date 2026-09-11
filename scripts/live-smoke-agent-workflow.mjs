import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

// Explicit live integration: normal provider policies/cache, bounded payloads.
// Each child also checks the real executable's JSON output and clean shutdown.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const payloads = new Map();

async function run(name, args, expectedError) {
  const started = performance.now();
  const child = spawn(process.execPath, [cli, ...args, "--json"], { cwd: repoRoot });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
  } finally {
    clearTimeout(timer);
  }
  assert.notEqual(code, null, `${name}: CLI exceeded three minutes`);
  const data = JSON.parse(code === 0 ? stdout : stderr);
  if (expectedError) {
    assert.notEqual(code, 0, name);
    assert.equal(data.error.code, expectedError, name);
    assert.equal(data.error.retryable, false, name);
  } else {
    assert.equal(code, 0, `${name}: ${stderr}`);
    assert.equal(data.error, undefined, name);
  }
  payloads.set(name, data);
  console.log(JSON.stringify({ name, ms: Math.round(performance.now() - started), bytes: stdout.length, expectedError }));
  return data;
}

const at = new Date(Math.ceil(Date.now() / 21_600_000) * 21_600_000).toISOString();
const later = new Date(Date.parse(at) + 2 * 3_600_000).toISOString();
const point = ["--lat", "50.08", "--lon", "14.43"];
const instant = ["--at", at];
const range = ["--from", at, "--to", later];
const field = ["--fields", "temperature_2m"];
const pressure = ["--vars", "temperature", "--levels", "850"];
const twoPoints = ["--point", "50.08,14.43", "--point", "49.2,16.61"];
const line = ["--start", "50.08,14.43", "--end", "49.2,16.61"];
const manyPoints = Array.from({ length: 25 }, (_, i) =>
  ["--point", `${50 + i * 0.01},${14 + i * 0.01}`]).flat();

await run("discovery", ["catalog", "--dataset", "gfs", "--search", "temperature", "--sections", "fields", "--limit", "3"]);
await run("capabilities", ["capabilities", "--dataset", "gfs", "--point", "50.08,14.43", ...field]);
const availability = await run("availability", ["availability", "--dataset", "gfs", ...point, ...instant, ...field]);
assert.equal(availability.coverage, "complete");
assert.equal(typeof availability.initialization, "string");
const runFlags = ["--run", availability.initialization];
const query = ["query", "--dataset", "gfs", ...runFlags];

await run("point-field", [...query, ...point, ...instant, ...field]);
await run("point-field-warm", [...query, ...point, ...instant, ...field]);
await run("point-profile", [...query, ...point, ...instant, "--vars", "temperature,wind", "--levels", "850,700,500"]);
await run("points-mixed", [...query, ...twoPoints, ...instant, "--vars", "temperature", "--levels", "850,700", ...field]);
await run("timeseries-field", [...query, ...point, ...range, ...field]);
await run("points-timeseries", [...query, ...twoPoints, ...range, ...pressure]);
await run("transect", [...query, ...line, "--samples", "5", ...instant, ...pressure]);
await run("transect-25", [...query, ...line, "--samples", "25", ...instant, ...pressure]);
await run("points-25", [...query, ...manyPoints, ...instant, ...pressure]);
await run("area", [
  ...query, "--west", "14", "--east", "14.5", "--south", "50", "--north", "50.5",
  ...instant, ...field, "--percentiles", "10,50,90", "--extrema",
]);
await run("wide-profile", [
  ...query, ...point, ...instant,
  "--vars", "temperature,relative_humidity,u_wind,v_wind,geopotential_height",
  "--levels", "1000,925,850,700,500",
]);
await run("layer-diagnostic", [
  "diagnose", "--dataset", "gfs", ...runFlags, ...point, ...instant,
  "--kind", "layer", "--lower", "850", "--upper", "700", "--diagnostics", "wind_shear",
]);
await run("gefs-wind", ["query", "--dataset", "gefs", ...point, ...instant, "--fields", "wind_10m", "--members", "c00,p01"]);
await run("ifs-field", ["query", "--dataset", "ifs", ...point, ...instant, ...field]);
await run("alignment", ["align", ...point, ...instant, "--source", `gfs@${availability.initialization}`, "--source", "ifs", ...field]);
await run("bundled-diagnostic", [
  ...query, ...point, ...instant, "--vars", "temperature,wind", "--levels", "850,700",
  "--diagnostic", JSON.stringify({ kind: "layer", lowerPressureHpa: 850, upperPressureHpa: 700, diagnostics: ["wind_shear"] }),
]);
await run("oversized", [...query, ...twoPoints, ...range, ...field, "--max-point-steps", "2"], "INVALID_REQUEST");
await run("out-of-domain", ["query", "--dataset", "icon-d2", "--lat", "0", "--lon", "0", ...instant, ...field], "OUT_OF_DOMAIN");

function result(name) { return payloads.get(name).result; }
function finite(value) { assert(Number.isFinite(value), `Expected finite evidence, got ${value}`); }
function temperature(profile) {
  const value = profile.fields.find(field => field.id === "temperature_2m").values.temperatureC;
  finite(value);
  return value;
}

assert(payloads.get("discovery").matches.some(match => match.id === "temperature_2m"));
assert.equal(payloads.get("capabilities").supported, true);
const single = result("point-field");
assert.equal(single.run, availability.initialization);
assert.equal(single.validTime, at);
assert.equal(single.source.access, "s3_range");
assert.equal(temperature(result("point-field-warm")), temperature(single));
assert.equal(result("point-field-warm").source.cacheHit, true);
const profile = result("point-profile");
assert.equal(profile.levels.length, 3);
for (const level of profile.levels) { finite(level.temperatureC); finite(level.windSpeedMs); }
const points = result("points-mixed").points;
assert.equal(points.length, 2);
for (const point of points) {
  assert.equal(point.levels.length, 2);
  for (const level of point.levels) finite(level.temperatureC);
  temperature(point);
}
assert.equal(temperature(points[0]), temperature(single));
assert.equal(points[0].levels[0].temperatureC, profile.levels[0].temperatureC);
const series = result("timeseries-field").series;
assert.equal(series.length, 3);
assert.equal(temperature(series[0]), temperature(single));
for (const step of series) temperature(step);
const pointSeries = result("points-timeseries").series;
assert.equal(pointSeries.length, 3);
for (const step of pointSeries) {
  assert.equal(step.points.length, 2);
  for (const point of step.points) finite(point.levels[0].temperatureC);
}
assert.equal(pointSeries[0].points[0].levels[0].temperatureC, profile.levels[0].temperatureC);
for (const [name, size] of [["transect", 5], ["transect-25", 25]]) {
  const transect = result(name);
  assert.equal(transect.samples.length, size);
  assert(transect.totalDistanceKm > 0);
  for (const sample of transect.samples) finite(sample.levels[0].temperatureC);
  assert.equal(transect.samples[0].levels[0].temperatureC, profile.levels[0].temperatureC);
}
assert.equal(result("points-25").points.length, 25);
for (const point of result("points-25").points) finite(point.levels[0].temperatureC);
const area = result("area");
assert.equal(area.source.access, "nomads_grib_filter");
assert(area.statistics.definedGridPoints > 0);
finite(area.statistics.mean);
assert.equal(area.distribution.percentiles.length, 3);
const wide = result("wide-profile");
assert.equal(wide.levels.length, 5);
assert.equal(wide.source.access, "nomads_grib_filter");
for (const level of wide.levels) {
  for (const field of ["temperatureC", "relativeHumidityPct", "uWindMs", "vWindMs", "geopotentialHeightGpm"]) finite(level[field]);
}
const shear = result("layer-diagnostic").diagnostics[0].values.windShearMagnitudeMs;
finite(shear);
const bundle = result("bundled-diagnostic");
assert.equal(bundle.state.levels.length, 2);
assert.equal(bundle.diagnostics.length, 1);
assert.equal(bundle.diagnostics[0].result.diagnostics[0].values.windShearMagnitudeMs, shear);
const ensemble = result("gefs-wind");
assert.equal(ensemble.selection.members.length, 2);
assert.equal(ensemble.fieldSummaries[0].outputs[0].distribution.memberCount, 2);
assert(ensemble.windVectorSummaries.length > 0);
finite(ensemble.fieldSummaries[0].outputs[0].distribution.mean);
temperature(result("ifs-field"));
const aligned = payloads.get("alignment");
assert.equal(aligned.sources.length, 2);
assert(aligned.sources.every(source => source.status === "ok"));
console.log(JSON.stringify({ passed: payloads.size, run: availability.initialization, validTime: at }));
