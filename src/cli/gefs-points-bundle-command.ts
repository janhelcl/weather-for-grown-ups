import type { Command } from "commander";
import { GefsPointsBundleService } from "../core/gefs-points-bundle.js";
import { gefsPointsBundleResultSchema } from "../schema/gefs-points-bundle.js";
import type { PointCoordinate } from "../schema/query.js";
import {
  collectPoint,
  gefsBundleSelection,
  parseGefsMembers,
  parseNumbers,
} from "./shared.js";

export function registerGefsPointsBundleCommand(program: Command): void {
  program
    .command("ensemble-fields-points")
    .description("Fetch one mixed GEFS pressure/non-isobaric selection across multiple points with one selected file per member")
    .requiredOption("--point <lat,lon>", "Point to sample; repeat up to 20 times", collectPoint)
    .option("--run <iso|latest>", "GEFS initialization cycle", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time on the native three-hour GEFS cadence")
    .option("--vars <list>", "Comma-separated GEFS pressure variables; can include dew_point/potential_temperature")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated GEFS pgrb2a non-isobaric fields")
    .option("--members <list>", "Comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "Comma-separated quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--include-members", "Include every member's selected values at every point")
    .option("--max-member-samples <number>", "Maximum point × member × scalar-output cells when --include-members is set", Number, 5000)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const points = options.point as PointCoordinate[];
      const selection = gefsBundleSelection(options.vars, options.levels, options.fields, "temperature", "850");
      const result = gefsPointsBundleResultSchema.parse(await new GefsPointsBundleService().getPoints({
        points,
        run: options.run,
        validTime: options.valid,
        selection,
        ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
        quantiles: parseNumbers(options.quantiles),
        includeMembers: Boolean(options.includeMembers),
        maxMemberSamples: options.maxMemberSamples,
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));

      console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`${result.points.length} points; ${result.selection.members.length} members; one selected member file reused across points`);
      console.log(`Source ${result.source.provider} (${result.source.access}); allCacheHit=${result.source.allCacheHit}`);
      for (const [index, point] of result.points.entries()) {
        console.log(`Point ${index + 1}: ${point.requestedPoint.latitude},${point.requestedPoint.longitude} → grid ${point.gridPoint.latitude},${point.gridPoint.longitude}`);
        if (point.pressureSummaries.length > 0) {
          console.table(point.pressureSummaries.map((summary) => ({
            pressureHpa: summary.pressureLevelHpa,
            variable: summary.variable,
            unit: summary.unit,
            mean: summary.distribution.mean,
            populationStdDev: summary.distribution.populationStdDev,
            min: summary.distribution.min,
            max: summary.distribution.max,
          })));
        }
        if (point.fieldSummaries.length > 0) {
          console.dir(point.fieldSummaries, { depth: null });
        }
        if (point.members) {
          for (const member of point.members) {
            console.log(`${member.member}${member.cacheHit ? " (cache)" : ""}`);
            if (member.pressureValues.length > 0) console.table(member.pressureValues);
            if (member.fields.length > 0) console.dir(member.fields, { depth: null });
          }
        }
      }
    });
}
