import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";
import {
  floorToIconD2EpsCycle,
  iconD2EpsValidTime,
} from "../src/sources/icon-d2-eps.js";

const safelyPublishedRun = floorToIconD2EpsCycle(
  new Date(Date.now() - 12 * 3_600_000),
);
const validTime = iconD2EpsValidTime(safelyPublishedRun, 6);

const diagnosticCacheDir = "/tmp/wfg-live-icon-d2-eps-diagnostics";
process.env.WFG_CACHE_DIR = diagnosticCacheDir;

let result: Awaited<ReturnType<UnifiedAtmosphereQueryService["query"]>>;
try {
  result = await new UnifiedAtmosphereQueryService().query({
  dataset: "icon-d2-eps",
  geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
  time: { at: validTime.toISOString() },
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850],
    fields: ["convective_rain", "convective_snow", "column_maximum_reflectivity"],
  },
  forecast: { run: safelyPublishedRun.toISOString() },
  ensemble: {
    members: ["p01", "p02"],
    quantiles: [0.5],
  },
  });
} catch (error) {
  await dumpRemappedInventories(diagnosticCacheDir);
  throw error;
}

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


async function dumpRemappedInventories(cacheDir: string): Promise<void> {
  for (const subdir of ["icon-d2-eps-members", "icon-d2-eps-remapped"]) {
    const dir = join(cacheDir, subdir);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files.filter((name) => name.endsWith(".grib2"))) {
      const path = join(dir, file);
      const { stdout } = await execa(process.env.WGRIB2_PATH ?? "wgrib2", [path, "-s"]);
      const relevant = stdout
        .split(/\r?\n/)
        .filter((line) =>
          /RAIN|SNOW|parmcat=1|parm=55|parm=76|BREF|REFC|DBZ/i.test(line));
      if (relevant.length > 0) {
        console.error(`WFG EPS DIAGNOSTIC ${subdir}/${file}\n${relevant.join("\n")}`);
      }
    }
  }
}
