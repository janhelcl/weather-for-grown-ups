#!/usr/bin/env node
import { Command } from "commander";
import { LatestRunResolver } from "./core/latest-run.js";
import { ProfileService } from "./core/profile.js";
import type { ProfileSourceId, VariableId } from "./schema/query.js";

const program = new Command();
program.name("wfg").description("Weather for Grown Ups — agent-native NOAA GFS access").version("0.1.0");

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
    const service = new ProfileService();
    const variables = String(options.vars).split(",").map((v) => v.trim()) as VariableId[];
    const pressureLevelsHpa = String(options.levels).split(",").map((v) => Number(v.trim()));

    const result = await service.getProfile({
      latitude: options.lat,
      longitude: options.lon,
      run: options.run,
      validTime: options.valid,
      variables,
      pressureLevelsHpa,
      source: options.source as ProfileSourceId,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
    console.log(`Source ${result.source.provider} (${result.source.access})`);
    console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
    console.table(
      result.levels.map((level) => ({
        hPa: level.pressureHpa,
        tempC: round(level.temperatureC),
        rhPct: round(level.relativeHumidityPct),
        windMs: round(level.windSpeedMs),
        windDeg: round(level.windDirectionDeg),
      })),
    );
  });

await program.parseAsync();

function round(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 10) / 10;
}
