#!/usr/bin/env node
import { Command } from "commander";
import { getGfsPressureCatalog } from "./catalog/catalog.js";
import { AreaSummaryService } from "./core/area-summary.js";
import { LatestRunResolver } from "./core/latest-run.js";
import { ProfileService } from "./core/profile.js";
import { TimeSeriesService } from "./core/time-series.js";
import type { ProfileSourceId, RawVariableId, VariableId } from "./schema/query.js";

const program = new Command();
program.name("wfg").description("Weather for Grown Ups — agent-native NOAA GFS access").version("0.1.0");

program
  .command("catalog")
  .description("Show supported GFS pressure-level variables and levels")
  .option("--json", "Output JSON")
  .action((options) => {
    const catalog = getGfsPressureCatalog();
    if (options.json) {
      console.log(JSON.stringify(catalog, null, 2));
      return;
    }
    console.table(catalog.variables.map((variable) => ({
      id: variable.id,
      kind: variable.kind,
      gfs: "gfsCode" in variable ? variable.gfsCode : "derived",
      output: variable.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
    })));
    console.log(`Pressure levels (hPa): ${catalog.pressureLevelsHpa.join(", ")}`);
  });

program
  .command("latest")
  .description("Resolve the latest complete GFS 0.25° run")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const run = await new LatestRunResolver().resolveLatestRun();
    if (options.json) {
      console.log(JSON.stringify({ model: "gfs_0p25", run: run.toISOString(), completeness: "f384" }, null, 2));
      return;
    }
    console.log(run.toISOString());
  });

program
  .command("profile")
  .description("Fetch a vertical GFS pressure profile for a point")
  .requiredOption("--lat <number>", "Latitude", Number)
  .requiredOption("--lon <number>", "Longitude", Number)
  .option("--run <iso|latest>", "GFS run initialization, or latest complete run", "latest")
  .requiredOption("--valid <iso>", "Forecast valid time")
  .option("--vars <list>", "Comma-separated variables", "temperature,relative_humidity,wind")
  .option("--levels <list>", "Comma-separated pressure levels in hPa", "1000,925,850,700,500")
  .option("--source <nomads|s3>", "Data access path", "nomads")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const result = await new ProfileService().getProfile({
      latitude: options.lat,
      longitude: options.lon,
      run: options.run,
      validTime: options.valid,
      variables: parseVariables(options.vars),
      pressureLevelsHpa: parseLevels(options.levels),
      source: options.source as ProfileSourceId,
    });
    if (options.json) return console.log(JSON.stringify(result, null, 2));
    console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
    console.log(`Source ${result.source.provider} (${result.source.access})`);
    console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
    console.table(result.levels);
  });

program
  .command("timeseries")
  .description("Fetch native GFS forecast steps for a point over a valid-time range")
  .requiredOption("--lat <number>", "Latitude", Number)
  .requiredOption("--lon <number>", "Longitude", Number)
  .option("--run <iso|latest>", "GFS run initialization, or latest complete run", "latest")
  .requiredOption("--from <iso>", "Inclusive valid-time range start")
  .requiredOption("--to <iso>", "Inclusive valid-time range end")
  .option("--vars <list>", "Comma-separated variables", "temperature,relative_humidity,wind")
  .option("--levels <list>", "Comma-separated pressure levels in hPa", "1000,925,850,700,500")
  .option("--source <nomads|s3>", "Data access path", "s3")
  .option("--max-steps <number>", "Maximum native forecast steps", Number, 160)
  .option("--json", "Output JSON")
  .action(async (options) => {
    const result = await new TimeSeriesService().getTimeSeries({
      latitude: options.lat,
      longitude: options.lon,
      run: options.run,
      startTime: options.from,
      endTime: options.to,
      variables: parseVariables(options.vars),
      pressureLevelsHpa: parseLevels(options.levels),
      source: options.source as ProfileSourceId,
      maxSteps: options.maxSteps,
    });
    if (options.json) return console.log(JSON.stringify(result, null, 2));
    console.log(`GFS ${result.run}  ${result.requestedStartTime} → ${result.requestedEndTime}`);
    console.log(`Source ${result.source.provider} (${result.source.access})`);
    console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
    console.table(result.series.flatMap((step) =>
      step.levels.map((level) => ({ valid: step.validTime, f: step.forecastHour, ...level, cacheHit: step.cacheHit })),
    ));
  });

program
  .command("area")
  .description("Summarize one raw GFS pressure field over a bounded area")
  .requiredOption("--west <number>", "Western longitude", Number)
  .requiredOption("--east <number>", "Eastern longitude", Number)
  .requiredOption("--south <number>", "Southern latitude", Number)
  .requiredOption("--north <number>", "Northern latitude", Number)
  .option("--run <iso|latest>", "GFS run initialization, or latest complete run", "latest")
  .requiredOption("--valid <iso>", "Forecast valid time")
  .requiredOption("--var <id>", "One raw pressure-level variable")
  .requiredOption("--level <hpa>", "Pressure level in hPa", Number)
  .option("--max-grid-points <number>", "Maximum estimated GFS grid points", Number, 50000)
  .option("--json", "Output JSON")
  .action(async (options) => {
    const result = await new AreaSummaryService().summarize({
      westLongitude: options.west,
      eastLongitude: options.east,
      southLatitude: options.south,
      northLatitude: options.north,
      run: options.run,
      validTime: options.valid,
      variable: options.var as RawVariableId,
      pressureLevelHpa: options.level,
      maxGridPoints: options.maxGridPoints,
    });
    if (options.json) return console.log(JSON.stringify(result, null, 2));
    console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
    console.log(`${result.variable.id} ${result.variable.pressureHpa} hPa [${result.variable.unit}]`);
    console.table([result.statistics]);
  });

await program.parseAsync();

function parseVariables(value: unknown): VariableId[] {
  return String(value).split(",").map((variable) => variable.trim()) as VariableId[];
}

function parseLevels(value: unknown): number[] {
  return String(value).split(",").map((level) => Number(level.trim()));
}
