import type { Command } from "commander";
import { GefsTransectService } from "../core/gefs-transect.js";
import { TransectService } from "../core/transect.js";
import { gefsTransectResultSchema } from "../schema/gefs-transect.js";
import { transectResultSchema } from "../schema/transect-result.js";
import type { PointCoordinate, VariableId } from "../schema/query.js";
import {
  RUN_HELP,
  gefsBundleSelection,
  parseAtmosphericModel,
  parseGefsMembers,
  parseLevels,
  parseNumbers,
} from "./shared.js";

export function registerTransectCommand(program: Command): void {
  program
    .command("transect")
    .description("Sample a great-circle atmospheric cross-section from GFS or GEFS")
    .option("--model <gfs|gefs>", "Atmospheric model family", "gfs")
    .requiredOption("--start <lat,lon>", "Transect start coordinate")
    .requiredOption("--end <lat,lon>", "Transect end coordinate")
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated published pressure levels in hPa")
    .option("--fields <list>", "GEFS-only comma-separated pgrb2a non-isobaric fields")
    .option("--members <list>", "GEFS-only comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "GEFS-only comma-separated quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--include-members", "GEFS-only: include member values at every transect sample")
    .option("--max-member-samples <number>", "GEFS-only member response guardrail", Number, 5000)
    .option("--samples <number>", "Evenly spaced great-circle samples (GFS 2-50, GEFS 2-20)", Number, 20)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const model = parseAtmosphericModel(options.model);
      const start = parsePoint(options.start);
      const end = parsePoint(options.end);

      if (model === "gfs") {
        if (options.fields !== undefined || options.members !== undefined || options.includeMembers) {
          throw new Error("--fields, --members and --include-members are only valid with --model gefs");
        }
        if (options.vars === undefined || options.levels === undefined) {
          throw new Error("GFS transects require --vars and --levels");
        }
        const result = transectResultSchema.parse(await new TransectService().getTransect({
          start,
          end,
          run: options.run,
          validTime: options.valid,
          variables: parseVariables(options.vars),
          pressureLevelsHpa: parseLevels(options.levels),
          samples: options.samples,
        }));
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
        console.log(`Great-circle transect ${result.totalDistanceKm.toFixed(1)} km; ${result.samples.length} samples; source ${result.source.provider} (${result.source.access})`);
        console.table(result.samples.flatMap((sample) => sample.levels.map((level) => ({
          sample: sample.index,
          distanceKm: Number(sample.distanceKm.toFixed(1)),
          latitude: Number(sample.requestedPoint.latitude.toFixed(4)),
          longitude: Number(sample.requestedPoint.longitude.toFixed(4)),
          gridLatitude: sample.gridPoint.latitude,
          gridLongitude: sample.gridPoint.longitude,
          ...level,
        }))));
        return;
      }

      if (options.run === "latest_complete") {
        throw new Error("GEFS transects support --run latest or an explicit GEFS cycle, not latest_complete");
      }
      const result = gefsTransectResultSchema.parse(await new GefsTransectService().getTransect({
        start,
        end,
        run: options.run,
        validTime: options.valid,
        selection: gefsBundleSelection(options.vars, options.levels, options.fields, "temperature", "850"),
        ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
        quantiles: parseNumbers(options.quantiles),
        includeMembers: Boolean(options.includeMembers),
        maxMemberSamples: options.maxMemberSamples,
        samples: options.samples,
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`Great-circle transect ${result.totalDistanceKm.toFixed(1)} km; ${result.samples.length} samples; ${result.selection.members.length} members`);
      console.log(`Source ${result.source.provider} (${result.source.access}); one selected member file reused across the complete path; allCacheHit=${result.source.allCacheHit}`);
      for (const sample of result.samples) {
        console.log(`Sample ${sample.index}  ${sample.distanceKm.toFixed(1)} km  ${sample.requestedPoint.latitude.toFixed(4)},${sample.requestedPoint.longitude.toFixed(4)} → grid ${sample.gridPoint.latitude},${sample.gridPoint.longitude}`);
        if (sample.pressureSummaries.length > 0) {
          console.table(sample.pressureSummaries.map((summary) => ({
            pressureHpa: summary.pressureLevelHpa,
            variable: summary.variable,
            unit: summary.unit,
            mean: summary.distribution.mean,
            populationStdDev: summary.distribution.populationStdDev,
            min: summary.distribution.min,
            max: summary.distribution.max,
          })));
        }
        if (sample.fieldSummaries.length > 0) console.dir(sample.fieldSummaries, { depth: null });
        if (sample.members) console.dir(sample.members, { depth: null });
      }
    });
}

function parsePoint(value: unknown): PointCoordinate {
  const parts = String(value).split(",").map((part) => part.trim());
  if (parts.length !== 2) throw new Error(`Expected lat,lon, received: ${String(value)}`);
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Expected numeric lat,lon, received: ${String(value)}`);
  }
  return { latitude, longitude };
}

function parseVariables(value: unknown): VariableId[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean) as VariableId[];
}
