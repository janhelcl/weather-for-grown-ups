import type { Command } from "commander";
import { GEFS_MEMBERS, type GefsMember, type GefsPressureVariableId } from "../catalog/gefs.js";
import { GefsEnsembleService } from "../core/gefs-ensemble.js";
import { gefsEnsembleResultSchema } from "../schema/gefs-ensemble.js";

export function registerEnsembleCommand(program: Command): void {
  program
    .command("ensemble")
    .description("Sample one GEFS 0.5° pressure-level field across control and perturbed members")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest>", "GEFS run initialization; latest = newest cycle satisfying this member/time selection", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time on the native three-hour GEFS cadence")
    .requiredOption("--var <id>", "Pressure-level variable: temperature, relative_humidity, u_wind, v_wind, geopotential_height")
    .requiredOption("--level <hpa>", "Pressure level in hPa", Number)
    .option("--members <list>", "Comma-separated GEFS members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "Comma-separated quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--gte <number>", "Optional threshold in normalized output units", Number)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await new GefsEnsembleService().getEnsemble({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        validTime: options.valid,
        variable: options.var as GefsPressureVariableId,
        pressureLevelHpa: options.level,
        ...(options.members === undefined ? {} : { members: parseMembers(options.members) }),
        quantiles: parseNumbers(options.quantiles),
        ...(options.gte === undefined ? {} : { thresholdGte: options.gte }),
      });
      gefsEnsembleResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));

      console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`${result.selection.variable}@${result.selection.pressureLevelHpa}hPa (${result.selection.unit}); ${result.summary.memberCount} members`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      console.table(result.members);
      console.table(result.summary.quantiles);
      console.log(`mean=${result.summary.mean}  populationStdDev=${result.summary.populationStdDev}  min=${result.summary.min}  max=${result.summary.max}`);
      if (result.summary.threshold) {
        console.log(`>= ${result.summary.threshold.value}: ${result.summary.threshold.count}/${result.summary.memberCount} = ${result.summary.threshold.fraction}; raw member fraction, not a calibrated probability`);
      }
    });
}

function parseMembers(value: unknown): GefsMember[] {
  return String(value).split(",").map((member) => member.trim()).filter(Boolean) as GefsMember[];
}

function parseNumbers(value: unknown): number[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean).map(Number);
}

export const DEFAULT_GEFS_MEMBERS = [...GEFS_MEMBERS];
