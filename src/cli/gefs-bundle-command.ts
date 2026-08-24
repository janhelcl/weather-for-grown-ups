import type { Command } from "commander";
import { GefsBundleTimeSeriesService } from "../core/gefs-bundle-timeseries.js";
import { GefsMemberBundleService } from "../core/gefs-member-bundle.js";
import { gefsBundleTimeSeriesResultSchema } from "../schema/gefs-bundle-timeseries.js";
import {
  gefsMemberBundleResultSchema,
  type GefsFieldTemporalResult,
} from "../schema/gefs-member-bundle.js";
import {
  gefsBundleSelection,
  parseGefsMembers,
  parseNumbers,
} from "./shared.js";

export function registerGefsBundleCommands(program: Command): void {
  program
    .command("ensemble-fields")
    .description("Fetch one mixed GEFS pressure/non-isobaric bundle with member-first ensemble summaries")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest>", "GEFS initialization cycle", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time on the native three-hour GEFS cadence")
    .option("--vars <list>", "Comma-separated GEFS pressure variables; can include dew_point/potential_temperature")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated GEFS pgrb2a non-isobaric fields")
    .option("--members <list>", "Comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "Comma-separated quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--include-members", "Include every member's complete selected bundle")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const selection = gefsBundleSelection(options.vars, options.levels, options.fields, "temperature", "850");
      const result = gefsMemberBundleResultSchema.parse(await new GefsMemberBundleService().getBundle({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        validTime: options.valid,
        selection,
        ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
        quantiles: parseNumbers(options.quantiles),
        includeMembers: Boolean(options.includeMembers),
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      printBundleHeader(result.run, result.validTime, result.forecastHour, result.selection.members.length, result.requestedPoint, result.gridPoint);
      printBundleSummaries(result.pressureSummaries, result.fieldSummaries);
      if (result.members) {
        for (const member of result.members) {
          console.log(`${member.member}${member.cacheHit ? " (cache)" : ""}`);
          if (member.pressureValues.length > 0) console.table(member.pressureValues);
          if (member.fields.length > 0) console.dir(member.fields, { depth: null });
        }
      }
    });

  program
    .command("ensemble-fields-timeseries")
    .description("Track one mixed GEFS pressure/non-isobaric selection across native three-hour forecast steps")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest>", "GEFS initialization cycle", "latest")
    .requiredOption("--from <iso>", "Inclusive valid-time range start")
    .requiredOption("--to <iso>", "Inclusive valid-time range end")
    .option("--vars <list>", "Comma-separated GEFS pressure variables; can include dew_point/potential_temperature")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated GEFS pgrb2a non-isobaric fields")
    .option("--members <list>", "Comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "Comma-separated quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--include-members", "Include every member's selected values at every forecast step")
    .option("--max-steps <number>", "Maximum native three-hour forecast steps", Number, 40)
    .option("--max-member-samples <number>", "Maximum step × member × scalar-output cells when --include-members is set", Number, 5000)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const selection = gefsBundleSelection(options.vars, options.levels, options.fields, "temperature", "850");
      const result = gefsBundleTimeSeriesResultSchema.parse(await new GefsBundleTimeSeriesService().getTimeSeries({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        startTime: options.from,
        endTime: options.to,
        selection,
        ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
        quantiles: parseNumbers(options.quantiles),
        includeMembers: Boolean(options.includeMembers),
        maxSteps: options.maxSteps,
        maxMemberSamples: options.maxMemberSamples,
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));

      console.log(`GEFS ${result.run}  ${result.startTime} → ${result.endTime}; ${result.series.length} native 3h steps; ${result.selection.members.length} members`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      for (const step of result.series) {
        console.log(`Valid ${step.validTime}  f${String(step.forecastHour).padStart(3, "0")}  allCacheHit=${step.allCacheHit}`);
        printBundleSummaries(step.pressureSummaries, step.fieldSummaries);
        if (step.members) {
          for (const member of step.members) {
            console.log(`${member.member}${member.cacheHit ? " (cache)" : ""}`);
            if (member.pressureValues.length > 0) console.table(member.pressureValues);
            if (member.fields.length > 0) console.dir(member.fields, { depth: null });
          }
        }
      }
    });
}

function printBundleHeader(
  run: string,
  validTime: string,
  forecastHour: number,
  memberCount: number,
  requestedPoint: { latitude: number; longitude: number },
  gridPoint: { latitude: number; longitude: number },
): void {
  console.log(`GEFS ${run}  valid ${validTime}  f${String(forecastHour).padStart(3, "0")}; ${memberCount} members`);
  console.log(`Requested ${requestedPoint.latitude},${requestedPoint.longitude} → grid ${gridPoint.latitude},${gridPoint.longitude}`);
}

function printBundleSummaries(
  pressureSummaries: readonly {
    variable: string;
    pressureLevelHpa: number;
    unit: string;
    distribution: { mean: number; populationStdDev: number; min: number; max: number };
  }[],
  fieldSummaries: readonly {
    field: string;
    temporal: GefsFieldTemporalResult;
    outputs: readonly (
      | { aggregation: "numeric_distribution"; field: string; unit: string; distribution: { mean: number; populationStdDev: number; min: number; max: number } }
      | { aggregation: "circular_direction"; field: "windDirectionDeg"; unit: "degree"; meanDirectionDeg: number; resultantLength: number }
    )[];
  }[],
): void {
  if (pressureSummaries.length > 0) {
    console.table(pressureSummaries.map((summary) => ({
      pressureHpa: summary.pressureLevelHpa,
      variable: summary.variable,
      unit: summary.unit,
      mean: summary.distribution.mean,
      populationStdDev: summary.distribution.populationStdDev,
      min: summary.distribution.min,
      max: summary.distribution.max,
    })));
  }
  if (fieldSummaries.length > 0) {
    console.table(fieldSummaries.flatMap((summary) => summary.outputs.map((output) =>
      output.aggregation === "numeric_distribution"
        ? {
            field: summary.field,
            output: output.field,
            temporal: formatTemporal(summary.temporal),
            unit: output.unit,
            mean: output.distribution.mean,
            populationStdDev: output.distribution.populationStdDev,
            min: output.distribution.min,
            max: output.distribution.max,
          }
        : {
            field: summary.field,
            output: output.field,
            temporal: formatTemporal(summary.temporal),
            unit: output.unit,
            meanDirectionDeg: output.meanDirectionDeg,
            resultantLength: output.resultantLength,
          },
    )));
  }
}

function formatTemporal(temporal: GefsFieldTemporalResult): string {
  if (temporal.type === "instantaneous") return "instantaneous";
  return `${temporal.type} f${temporal.startForecastHour}-f${temporal.endForecastHour}`;
}
