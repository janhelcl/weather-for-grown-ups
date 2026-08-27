import type { Command } from "commander";
import { HistoricalIndexBackfillService } from "../core/history-backfill.js";
import { HistoricalIndexService } from "../core/history-index.js";
import {
  DEFAULT_HISTORICAL_BACKFILL_MAX_FETCHES,
  historicalIndexBackfillResultSchema,
  historicalIndexBuildResultSchema,
} from "../schema/history-index.js";
import {
  DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS,
  HISTORICAL_GFS_CYCLE_HOURS_UTC,
  type HistoricalCycleHourUtc,
  type HistoricalGfsVariableId,
} from "../schema/history.js";
import { DEFAULT_LEVELS, parseLevels } from "./shared.js";

const DEFAULT_INDEX_VARIABLES = "temperature,relative_humidity,wind,geopotential_height";
const DEFAULT_INDEX_CYCLES = HISTORICAL_GFS_CYCLE_HOURS_UTC.join(",");

export function registerIndexCommand(program: Command): void {
  const index = program
    .command("index")
    .description("Manage local materialized atmospheric indexes used by operations such as analog search");

  index
    .command("build")
    .description("Materialize a bounded historical-analysis range into the local analog index")
    .option("--dataset <gfs-analysis>", "Indexed atmospheric dataset", "gfs-analysis")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--from <iso>", "Inclusive historical range start")
    .requiredOption("--to <iso>", "Inclusive historical range end")
    .option("--cycles <list>", "UTC analysis cycles: 0,6,12,18", DEFAULT_INDEX_CYCLES)
    .option("--vars <list>", "Pressure-level variables", DEFAULT_INDEX_VARIABLES)
    .option("--levels <list>", "Pressure levels in hPa", DEFAULT_LEVELS)
    .option("--max-steps <number>", "Maximum selected cycles materialized by this call", Number, DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      assertAnalysisDataset(options.dataset);
      const result = historicalIndexBuildResultSchema.parse(await new HistoricalIndexService().materialize({
        latitude: options.lat,
        longitude: options.lon,
        startTime: options.from,
        endTime: options.to,
        cycleHoursUtc: parseCycles(options.cycles),
        variables: parseVariables(options.vars),
        pressureLevelsHpa: parseLevels(options.levels),
        maxSteps: options.maxSteps,
      }));
      print(result, Boolean(options.json));
    });

  index
    .command("backfill")
    .description("Resumably backfill a large historical-analysis range into the local analog index")
    .option("--dataset <gfs-analysis>", "Indexed atmospheric dataset", "gfs-analysis")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--from <iso>", "Inclusive historical range start")
    .requiredOption("--to <iso>", "Inclusive historical range end")
    .option("--cycles <list>", "UTC analysis cycles: 0,6,12,18", DEFAULT_INDEX_CYCLES)
    .option("--vars <list>", "Pressure-level variables", DEFAULT_INDEX_VARIABLES)
    .option("--levels <list>", "Pressure levels in hPa", DEFAULT_LEVELS)
    .option("--max-fetches <number>", "Maximum missing profiles attempted by this invocation", Number, DEFAULT_HISTORICAL_BACKFILL_MAX_FETCHES)
    .option("--newest-first", "Fill newest missing cycles first")
    .option("--dry-run", "Plan without fetching or writing")
    .option("--continue-on-error", "Continue after an archive/profile error")
    .option("--json", "Output JSON")
    .action(async (options) => {
      assertAnalysisDataset(options.dataset);
      const result = historicalIndexBackfillResultSchema.parse(await new HistoricalIndexBackfillService().backfill({
        latitude: options.lat,
        longitude: options.lon,
        startTime: options.from,
        endTime: options.to,
        cycleHoursUtc: parseCycles(options.cycles),
        variables: parseVariables(options.vars),
        pressureLevelsHpa: parseLevels(options.levels),
        maxFetches: options.maxFetches,
        order: options.newestFirst ? "newest_first" : "oldest_first",
        dryRun: Boolean(options.dryRun),
        continueOnError: Boolean(options.continueOnError),
      }));
      print(result, Boolean(options.json));
    });
}

function assertAnalysisDataset(value: unknown): void {
  if (String(value).trim().toLowerCase() !== "gfs-analysis") {
    throw new Error(`Indexing currently supports only --dataset gfs-analysis, received: ${value}`);
  }
}

function parseVariables(value: unknown): HistoricalGfsVariableId[] {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as HistoricalGfsVariableId[];
}

function parseCycles(value: unknown): HistoricalCycleHourUtc[] {
  const cycles = String(value)
    .split(",")
    .map((item) => Number(item.trim()));
  if (
    cycles.length === 0
    || cycles.some((hour) => !HISTORICAL_GFS_CYCLE_HOURS_UTC.includes(hour as HistoricalCycleHourUtc))
  ) {
    throw new Error("Expected --cycles to contain only 0,6,12,18");
  }
  return cycles as HistoricalCycleHourUtc[];
}

function print(result: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.dir(result, { depth: null });
}
