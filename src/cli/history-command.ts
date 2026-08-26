import type { Command } from "commander";
import { HistoricalIndexBackfillService } from "../core/history-backfill.js";
import { HistoricalIndexService } from "../core/history-index.js";
import { HistoricalTimeSeriesService } from "../core/history-time-series.js";
import { HistoricalForecastVerificationService } from "../core/history-verification.js";
import { HistoricalProfileService } from "../core/history.js";
import {
  DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS,
  HISTORICAL_GFS_CYCLE_HOURS_UTC,
  type HistoricalCycleHourUtc,
  type HistoricalGfsVariableId,
} from "../schema/history.js";
import {
  historicalProfileResultSchema,
  historicalTimeSeriesResultSchema,
} from "../schema/history-result.js";
import {
  DEFAULT_HISTORICAL_BACKFILL_MAX_FETCHES,
  historicalAnalogResultSchema,
  historicalIndexBackfillResultSchema,
  historicalIndexBuildResultSchema,
} from "../schema/history-index.js";
import { historicalForecastVerificationResultSchema } from "../schema/history-verification-result.js";
import { DEFAULT_LEVELS, parseLevels } from "./shared.js";

const DEFAULT_HISTORY_VARIABLES = "temperature,relative_humidity,wind,geopotential_height";
const DEFAULT_HISTORY_CYCLES = HISTORICAL_GFS_CYCLE_HOURS_UTC.join(",");

export function registerHistoryCommand(program: Command): void {
  program
    .command("history")
    .description("Fetch a historical NOAA GFS Grid 4 analysis profile from the NCEI archive")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--at <iso>", "Exact historical GFS analysis cycle at 00, 06, 12, or 18 UTC")
    .option("--vars <list>", "Comma-separated historical pressure variables", DEFAULT_HISTORY_VARIABLES)
    .option("--levels <list>", "Comma-separated pressure levels in hPa", DEFAULT_LEVELS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const service = new HistoricalProfileService();
      const result = historicalProfileResultSchema.parse(await service.getHistoricalProfile({
        latitude: options.lat,
        longitude: options.lon,
        analysisTime: options.at,
        variables: parseHistoryVariables(options.vars),
        pressureLevelsHpa: parseLevels(options.levels),
      }));

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS Grid 4 analysis ${result.analysisTime}`);
      console.log(`Source ${result.source.provider} (${result.source.access})`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      console.table(result.levels);
      console.log(result.caveat);
    });

  program
    .command("history-timeseries")
    .description("Fetch a bounded series of historical NOAA GFS Grid 4 analyses from NCEI")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--from <iso>", "Inclusive start of historical range")
    .requiredOption("--to <iso>", "Inclusive end of historical range")
    .option("--cycles <list>", "Comma-separated UTC analysis hours to sample: 0,6,12,18", DEFAULT_HISTORY_CYCLES)
    .option("--vars <list>", "Comma-separated historical pressure variables", DEFAULT_HISTORY_VARIABLES)
    .option("--levels <list>", "Comma-separated pressure levels in hPa", DEFAULT_LEVELS)
    .option("--max-steps <number>", "Maximum selected analysis cycles allowed in one query", Number, DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const service = new HistoricalTimeSeriesService();
      const result = historicalTimeSeriesResultSchema.parse(await service.getHistoricalTimeSeries({
        latitude: options.lat,
        longitude: options.lon,
        startTime: options.from,
        endTime: options.to,
        cycleHoursUtc: parseHistoryCycles(options.cycles),
        variables: parseHistoryVariables(options.vars),
        pressureLevelsHpa: parseLevels(options.levels),
        maxSteps: options.maxSteps,
      }));

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS Grid 4 analyses ${result.requestedStartTime} → ${result.requestedEndTime}`);
      console.log(`Cycles UTC: ${result.selection.cycleHoursUtc.map((hour) => String(hour).padStart(2, "0")).join(", ")}`);
      console.log(`Source ${result.source.provider} (${result.source.access})`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      for (const step of result.series) {
        console.log(`\n${step.analysisTime} (${step.cacheHit ? "cache" : "upstream"})`);
        console.table(step.levels);
      }
      console.log(result.caveat);
    });

  program
    .command("history-index")
    .description("Materialize a bounded historical GFS analysis range into the local analog index")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--from <iso>", "Inclusive start of historical range")
    .requiredOption("--to <iso>", "Inclusive end of historical range")
    .option("--cycles <list>", "Comma-separated UTC analysis hours to materialize: 0,6,12,18", DEFAULT_HISTORY_CYCLES)
    .option("--vars <list>", "Comma-separated historical pressure variables", DEFAULT_HISTORY_VARIABLES)
    .option("--levels <list>", "Comma-separated pressure levels in hPa", DEFAULT_LEVELS)
    .option("--max-steps <number>", "Maximum selected analysis cycles materialized by this call", Number, DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const service = new HistoricalIndexService();
      const result = historicalIndexBuildResultSchema.parse(await service.materialize({
        latitude: options.lat,
        longitude: options.lon,
        startTime: options.from,
        endTime: options.to,
        cycleHoursUtc: parseHistoryCycles(options.cycles),
        variables: parseHistoryVariables(options.vars),
        pressureLevelsHpa: parseLevels(options.levels),
        maxSteps: options.maxSteps,
      }));

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Historical index: ${result.indexPath}`);
      console.log(`Materialized ${result.materialized} new profiles; ${result.totalMatchingRecords} matching profiles now available.`);
      console.log(`Range ${result.requestedStartTime} → ${result.requestedEndTime}`);
    });

  program
    .command("history-backfill")
    .description("Backfill a large historical GFS analysis range into the local analog index with resumable progress")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--from <iso>", "Inclusive start of historical range")
    .requiredOption("--to <iso>", "Inclusive end of historical range")
    .option("--cycles <list>", "Comma-separated UTC analysis hours to backfill: 0,6,12,18", DEFAULT_HISTORY_CYCLES)
    .option("--vars <list>", "Comma-separated historical pressure variables", DEFAULT_HISTORY_VARIABLES)
    .option("--levels <list>", "Comma-separated pressure levels in hPa", DEFAULT_LEVELS)
    .option("--max-fetches <number>", "Maximum missing profiles attempted by this invocation", Number, DEFAULT_HISTORICAL_BACKFILL_MAX_FETCHES)
    .option("--newest-first", "Fill the newest missing cycles first")
    .option("--dry-run", "Plan the backfill without fetching or writing profiles")
    .option("--continue-on-error", "Continue to later missing cycles after an archive/profile error")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const service = new HistoricalIndexBackfillService();
      const result = historicalIndexBackfillResultSchema.parse(await service.backfill({
        latitude: options.lat,
        longitude: options.lon,
        startTime: options.from,
        endTime: options.to,
        cycleHoursUtc: parseHistoryCycles(options.cycles),
        variables: parseHistoryVariables(options.vars),
        pressureLevelsHpa: parseLevels(options.levels),
        maxFetches: options.maxFetches,
        order: options.newestFirst ? "newest_first" : "oldest_first",
        dryRun: Boolean(options.dryRun),
        continueOnError: Boolean(options.continueOnError),
      }));

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Historical backfill ${result.status}: ${result.indexPath}`);
      console.log(`${result.selectedCycleCount} selected; ${result.alreadyMaterialized} already materialized.`);
      console.log(`Attempted ${result.attempted}/${result.fetchBudget}: ${result.upstreamFetches} upstream, ${result.cacheHits} cached; wrote ${result.materialized}.`);
      console.log(`${result.remaining} profiles remain${result.nextAnalysisTime ? `; next ${result.nextAnalysisTime}` : ""}.`);
      if (result.failures.length > 0) console.table(result.failures);
    });

  program
    .command("history-analogs")
    .description("Find locally materialized historical GFS analyses most similar to one target analysis")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--target <iso>", "Target GFS analysis cycle at 00, 06, 12, or 18 UTC")
    .option("--vars <list>", "Comma-separated historical pressure variables", DEFAULT_HISTORY_VARIABLES)
    .option("--levels <list>", "Comma-separated pressure levels in hPa", DEFAULT_LEVELS)
    .option("--count <number>", "Number of analogs to return, up to 20", Number, 5)
    .option("--exclude-within-hours <number>", "Exclude candidates this close in time to the target", Number, 24)
    .option("--no-fetch-target", "Require the target itself to already exist in the local index")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const service = new HistoricalIndexService();
      const result = historicalAnalogResultSchema.parse(await service.findAnalogs({
        latitude: options.lat,
        longitude: options.lon,
        targetTime: options.target,
        variables: parseHistoryVariables(options.vars),
        pressureLevelsHpa: parseLevels(options.levels),
        count: options.count,
        excludeWithinHours: options.excludeWithinHours,
        fetchTargetIfMissing: options.fetchTarget,
      }));

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Historical GFS analogs for ${result.targetTime}`);
      console.log(`Index ${result.indexPath}; ${result.candidateCount} eligible candidates`);
      console.log(`Metric ${result.metric.name} using ${result.metric.features.length} features (${result.metric.windRepresentation})`);
      console.table(result.analogs.map((analog) => ({
        rank: analog.rank,
        analysisTime: analog.analysisTime,
        distance: analog.distance,
      })));
      console.log(result.caveat);
    });

  program
    .command("history-verify")
    .description("Compare one archived GFS Grid 4 forecast with the later GFS analysis at the same valid time")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--valid <iso>", "Historical verification time at 00, 06, 12, or 18 UTC")
    .requiredOption("--lead-hours <number>", "Forecast lead in hours; multiple of 6, up to 192", Number)
    .option("--vars <list>", "Comma-separated historical pressure variables", DEFAULT_HISTORY_VARIABLES)
    .option("--levels <list>", "Comma-separated pressure levels in hPa", DEFAULT_LEVELS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const service = new HistoricalForecastVerificationService();
      const result = historicalForecastVerificationResultSchema.parse(await service.verify({
        latitude: options.lat,
        longitude: options.lon,
        validTime: options.valid,
        leadHours: options.leadHours,
        variables: parseHistoryVariables(options.vars),
        pressureLevelsHpa: parseLevels(options.levels),
      }));

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Archived GFS verification at ${result.validTime}`);
      console.log(`Forecast run ${result.forecastRun} +${result.leadHours}h → analysis ${result.analysis.analysisTime}`);
      console.log(`Comparison: ${result.comparison}`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      for (const level of result.pressureLevels) {
        console.log(`\n${level.pressureHpa} hPa`);
        console.table(level.changes);
      }
      console.log(result.caveat);
    });
}

function parseHistoryVariables(value: unknown): HistoricalGfsVariableId[] {
  return String(value)
    .split(",")
    .map((variable) => variable.trim())
    .filter(Boolean) as HistoricalGfsVariableId[];
}

export function parseHistoryCycles(value: unknown): HistoricalCycleHourUtc[] {
  const cycles = String(value)
    .split(",")
    .map((hour) => Number(hour.trim()));
  if (
    cycles.length === 0
    || cycles.some((hour) => !HISTORICAL_GFS_CYCLE_HOURS_UTC.includes(hour as HistoricalCycleHourUtc))
  ) {
    throw new Error("Expected --cycles to contain only 0,6,12,18");
  }
  return cycles as HistoricalCycleHourUtc[];
}
