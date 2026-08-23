import type { Command } from "commander";
import type { GefsMember, GefsPressureVariableId } from "../catalog/gefs.js";
import { GfsGefsComparisonService } from "../core/gfs-gefs-comparison.js";
import { gfsGefsComparisonResultSchema } from "../schema/gfs-gefs-comparison.js";

export function registerModelComparisonCommand(program: Command): void {
  program
    .command("compare-gfs-gefs")
    .description("Compare deterministic GFS with the aligned GEFS member distribution for one pressure-level field")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest>", "Shared GFS/GEFS initialization; latest = newest aligned cycle satisfying both models", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time on the native three-hour GEFS cadence")
    .requiredOption("--var <id>", "Shared raw pressure variable: temperature, relative_humidity, u_wind, v_wind, geopotential_height")
    .requiredOption("--level <hpa>", "Pressure level in hPa", Number)
    .option("--members <list>", "Comma-separated GEFS members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "Comma-separated GEFS quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await new GfsGefsComparisonService().compare({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        validTime: options.valid,
        variable: options.var as GefsPressureVariableId,
        pressureLevelHpa: options.level,
        ...(options.members === undefined ? {} : { members: parseMembers(options.members) }),
        quantiles: parseNumbers(options.quantiles),
      });
      gfsGefsComparisonResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));

      console.log(`GFS vs GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`${result.selection.variable}@${result.selection.pressureLevelHpa}hPa (${result.selection.unit})`);
      console.log(`GFS ${result.deterministicGfs.value}  GEFS mean ${result.gefs.summary.mean}  spread ${result.gefs.summary.populationStdDev}`);
      console.log(`delta=${result.comparison.deterministicMinusEnsembleMean}  standardized=${result.comparison.standardizedDifference ?? "undefined (zero member spread)"}`);
      console.log(`member position=${result.comparison.rangePosition}; at/below=${result.comparison.membersAtOrBelowDeterministic}/${result.gefs.summary.memberCount}`);
      console.table(result.gefs.summary.quantiles);
      console.log("Comparison uses raw model/member values; it is not a calibrated uncertainty or probability statement.");
    });
}

function parseMembers(value: unknown): GefsMember[] {
  return String(value).split(",").map((member) => member.trim()).filter(Boolean) as GefsMember[];
}

function parseNumbers(value: unknown): number[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean).map(Number);
}
