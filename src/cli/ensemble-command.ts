import type { Command } from "commander";
import type { RawGefsPgrb2aFieldId } from "../catalog/gefs-fields.js";
import { GEFS_MEMBERS, type GefsPressureVariableId } from "../catalog/gefs.js";
import { AtmosphericProfileService } from "../core/atmospheric-profile-service.js";
import { AtmosphericTimeSeriesService } from "../core/atmospheric-timeseries-service.js";
import { GefsEnsembleService } from "../core/gefs-ensemble.js";
import { gefsEnsembleProfileResultSchema } from "../schema/gefs-ensemble-profile.js";
import { gefsEnsembleTimeSeriesResultSchema } from "../schema/gefs-ensemble-timeseries.js";
import { gefsEnsembleResultSchema } from "../schema/gefs-ensemble.js";
import { parseGefsMembers, parseGefsVariables, parseNumbers } from "./shared.js";

export function registerEnsembleCommand(program: Command): void {
  program
    .command("ensemble")
    .description("Sample one raw GEFS 0.5° pgrb2a pressure-level or non-isobaric field across control and perturbed members")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest>", "GEFS run initialization; latest = newest cycle satisfying this member/time selection", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time on the native three-hour GEFS cadence")
    .option("--var <id>", "Pressure-level variable: temperature, relative_humidity, u_wind, v_wind, geopotential_height")
    .option("--level <hpa>", "Pressure level in hPa; required with --var", Number)
    .option("--field <id>", "Raw pgrb2a field, e.g. temperature_2m,total_precipitation,total_atmosphere_cloud_cover,cape_180mb")
    .option("--members <list>", "Comma-separated GEFS members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "Comma-separated quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--gte <number>", "Optional threshold in normalized output units", Number)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const hasField = options.field !== undefined;
      if (hasField && (options.var !== undefined || options.level !== undefined)) {
        throw new Error("ensemble accepts either --field or --var with --level, not both");
      }
      if (!hasField && (options.var === undefined || options.level === undefined)) {
        throw new Error("ensemble requires --field or both --var and --level");
      }
      const selection = hasField
        ? { field: options.field as RawGefsPgrb2aFieldId }
        : { variable: options.var as GefsPressureVariableId, pressureLevelHpa: options.level as number };
      const result = await new GefsEnsembleService().getEnsemble({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        validTime: options.valid,
        ...selection,
        ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
        quantiles: parseNumbers(options.quantiles),
        ...(options.gte === undefined ? {} : { thresholdGte: options.gte }),
      });
      gefsEnsembleResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));

      console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      if (result.selection.field) {
        console.log(`${result.selection.field} (${result.selection.unit}) @ ${result.selection.vertical?.description}; ${result.summary.memberCount} members; ${result.selection.temporal?.type}`);
      } else {
        console.log(`${result.selection.variable}@${result.selection.pressureLevelHpa}hPa (${result.selection.unit}); ${result.summary.memberCount} members`);
      }
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      console.table(result.members);
      console.table(result.summary.quantiles);
      console.log(`mean=${result.summary.mean}  populationStdDev=${result.summary.populationStdDev}  min=${result.summary.min}  max=${result.summary.max}`);
      if (result.summary.threshold) {
        console.log(`>= ${result.summary.threshold.value}: ${result.summary.threshold.count}/${result.summary.memberCount} = ${result.summary.threshold.fraction}; raw member fraction, not a calibrated probability`);
      }
    });

  program
    .command("ensemble-profile")
    .description("Explicit GEFS alias for `profile --model gefs`; summarize a multi-variable, multi-level ensemble profile")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest>", "GEFS run initialization; latest = newest cycle satisfying this member/time selection", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time on the native three-hour GEFS cadence")
    .requiredOption("--vars <list>", "Comma-separated raw pressure variables")
    .requiredOption("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--members <list>", "Comma-separated GEFS members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "Comma-separated quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--include-members", "Include each member's complete selected profile; summaries are always returned")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = gefsEnsembleProfileResultSchema.parse(await new AtmosphericProfileService().getProfile({
        model: "gefs_0p50",
        query: {
          latitude: options.lat,
          longitude: options.lon,
          run: options.run,
          validTime: options.valid,
          variables: parseGefsVariables(options.vars),
          pressureLevelsHpa: parseNumbers(options.levels),
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles),
          includeMembers: Boolean(options.includeMembers),
        },
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));

      console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`${result.selection.members.length} members; ${result.selection.variables.join(",")} @ ${result.selection.pressureLevelsHpa.join(",")} hPa`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      console.table(result.summaries.map((summary) => ({
        pressureLevelHpa: summary.pressureLevelHpa,
        variable: summary.variable,
        unit: summary.unit,
        mean: summary.mean,
        populationStdDev: summary.populationStdDev,
        min: summary.min,
        max: summary.max,
      })));
      if (result.members) {
        for (const member of result.members) {
          console.log(`${member.member}${member.cacheHit ? " (cache)" : ""}`);
          console.table(member.values);
        }
      }
    });

  program
    .command("ensemble-timeseries")
    .description("Explicit GEFS alias for `timeseries --model gefs`; track one ensemble distribution across native steps")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest>", "GEFS run initialization; latest = newest single cycle satisfying the complete time range/member selection", "latest")
    .requiredOption("--start <iso>", "First forecast valid time on the native three-hour GEFS cadence")
    .requiredOption("--end <iso>", "Last forecast valid time on the native three-hour GEFS cadence, inclusive")
    .requiredOption("--var <id>", "Pressure-level variable: temperature, relative_humidity, u_wind, v_wind, geopotential_height")
    .requiredOption("--level <hpa>", "Pressure level in hPa", Number)
    .option("--members <list>", "Comma-separated GEFS members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "Comma-separated quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--gte <number>", "Optional threshold in normalized output units", Number)
    .option("--include-members", "Include each member value at every step; summaries are always returned")
    .option("--max-steps <number>", "Maximum native forecast steps accepted", Number, 129)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = gefsEnsembleTimeSeriesResultSchema.parse(await new AtmosphericTimeSeriesService().getTimeSeries({
        model: "gefs_0p50",
        query: {
          latitude: options.lat,
          longitude: options.lon,
          run: options.run,
          startTime: options.start,
          endTime: options.end,
          variable: options.var as GefsPressureVariableId,
          pressureLevelHpa: options.level,
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles),
          ...(options.gte === undefined ? {} : { thresholdGte: options.gte }),
          includeMembers: Boolean(options.includeMembers),
          maxSteps: options.maxSteps,
        },
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));

      console.log(`GEFS ${result.run}  ${result.startTime} → ${result.endTime}  ${result.series.length} steps`);
      console.log(`${result.selection.variable}@${result.selection.pressureLevelHpa}hPa (${result.selection.unit}); ${result.selection.members.length} members`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      console.table(result.series.map((step) => ({
        validTime: step.validTime,
        forecastHour: step.forecastHour,
        mean: step.summary.mean,
        populationStdDev: step.summary.populationStdDev,
        min: step.summary.min,
        max: step.summary.max,
        ...(step.summary.threshold ? { thresholdFraction: step.summary.threshold.fraction } : {}),
      })));
      if (result.includeMembers) {
        for (const step of result.series) {
          console.log(`Members at ${step.validTime}`);
          console.table(step.members ?? []);
        }
      }
    });
}

export const DEFAULT_GEFS_MEMBERS = [...GEFS_MEMBERS];
