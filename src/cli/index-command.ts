import type { Command } from "commander";
import { InvalidRequestError } from "../failure.js";
import { HistoricalIndexBackfillService } from "../core/history-backfill.js";
import { HistoricalIndexService } from "../core/history-index.js";
import { VerificationIndexBackfillService } from "../core/verification-index-backfill.js";
import { VerificationIndexSkillService } from "../core/verification-index-skill.js";
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
import {
  DEFAULT_VERIFICATION_INDEX_MAX_FETCHES,
  verificationIndexBackfillResultSchema,
  verificationIndexSkillResultSchema,
} from "../schema/verification-index.js";
import { DEFAULT_LEVELS, numberOption, parseNumberList } from "./shared.js";

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
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .requiredOption("--from <iso>", "Inclusive historical range start")
    .requiredOption("--to <iso>", "Inclusive historical range end")
    .option("--cycles <list>", "UTC analysis cycles: 0,6,12,18", DEFAULT_INDEX_CYCLES)
    .option("--vars <list>", "Pressure-level variables", DEFAULT_INDEX_VARIABLES)
    .option("--levels <list>", "Pressure levels in hPa", DEFAULT_LEVELS)
    .option("--max-steps <number>", "Maximum selected cycles materialized by this call", numberOption("--max-steps"), DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS)
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
        pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
        maxSteps: options.maxSteps,
      }));
      print(result, Boolean(options.json));
    });

  index
    .command("backfill")
    .description("Resumably backfill a large historical-analysis range into the local analog index")
    .option("--dataset <gfs-analysis>", "Indexed atmospheric dataset", "gfs-analysis")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .requiredOption("--from <iso>", "Inclusive historical range start")
    .requiredOption("--to <iso>", "Inclusive historical range end")
    .option("--cycles <list>", "UTC analysis cycles: 0,6,12,18", DEFAULT_INDEX_CYCLES)
    .option("--vars <list>", "Pressure-level variables", DEFAULT_INDEX_VARIABLES)
    .option("--levels <list>", "Pressure levels in hPa", DEFAULT_LEVELS)
    .option("--max-fetches <number>", "Maximum missing profiles attempted by this invocation", numberOption("--max-fetches"), DEFAULT_HISTORICAL_BACKFILL_MAX_FETCHES)
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
        pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
        maxFetches: options.maxFetches,
        order: options.newestFirst ? "newest_first" : "oldest_first",
        dryRun: Boolean(options.dryRun),
        continueOnError: Boolean(options.continueOnError),
      }));
      print(result, Boolean(options.json));
    });

  index
    .command("verification-backfill")
    .description("Resumably materialize atomic forecast-verification cases into the local verification corpus")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .requiredOption("--from <iso>", "Inclusive verification range start")
    .requiredOption("--to <iso>", "Inclusive verification range end")
    .requiredOption("--lead-hours <list>", "Forecast leads in hours; multiples of 6")
    .option("--reference <gfs-analysis|igra>", "Verification reference", "gfs-analysis")
    .option("--cycles <list>", "UTC verification cycles: 0,6,12,18", "0,12")
    .option("--vars <list>", "Pressure-level variables", DEFAULT_INDEX_VARIABLES)
    .option("--levels <list>", "Pressure levels in hPa", DEFAULT_LEVELS)
    .option("--grid <0p25|0p50>", "Archived GFS grid; IGRA only")
    .option("--station <id>", "Explicit 11-character IGRA station ID")
    .option("--max-station-distance-km <number>", "Maximum IGRA station distance", numberOption("--max-station-distance-km"))
    .option("--max-fetches <number>", "Maximum missing atomic cases attempted by this invocation", numberOption("--max-fetches"), DEFAULT_VERIFICATION_INDEX_MAX_FETCHES)
    .option("--newest-first", "Fill newest missing cases first")
    .option("--dry-run", "Plan without fetching or writing")
    .option("--continue-on-error", "Continue after an archive/observation error")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = verificationIndexBackfillResultSchema.parse(
        await new VerificationIndexBackfillService().backfill({
          referenceDataset: parseReference(options.reference),
          latitude: options.lat,
          longitude: options.lon,
          startTime: options.from,
          endTime: options.to,
          cycleHoursUtc: parseCycles(options.cycles),
          leadHours: parseNumberList(options.leadHours, "--lead-hours"),
          variables: parseStringList(options.vars),
          pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
          ...(options.grid === undefined ? {} : { gfsGrid: options.grid }),
          ...(options.station === undefined ? {} : { stationId: options.station }),
          ...(options.maxStationDistanceKm === undefined
            ? {}
            : { maxStationDistanceKm: options.maxStationDistanceKm }),
          maxFetches: options.maxFetches,
          order: options.newestFirst ? "newest_first" : "oldest_first",
          dryRun: Boolean(options.dryRun),
          continueOnError: Boolean(options.continueOnError),
        }),
      );
      print(result, Boolean(options.json));
    });

  index
    .command("verification-summary")
    .description("Summarize materialized verification skill locally without NOAA requests")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .requiredOption("--from <iso>", "Inclusive verification range start")
    .requiredOption("--to <iso>", "Inclusive verification range end")
    .requiredOption("--lead-hours <list>", "Forecast leads in hours; multiples of 6")
    .option("--reference <gfs-analysis|igra>", "Verification reference", "gfs-analysis")
    .option("--cycles <list>", "UTC verification cycles: 0,6,12,18", "0,12")
    .option("--months <list>", "Optional UTC month filter, e.g. 3,4,5")
    .option("--vars <list>", "Pressure-level variables", DEFAULT_INDEX_VARIABLES)
    .option("--levels <list>", "Pressure levels in hPa", DEFAULT_LEVELS)
    .option("--grid <0p25|0p50>", "Filter actual archived GFS grid; IGRA only")
    .option("--station <id>", "Filter actual IGRA station ID")
    .option("--max-station-distance-km <number>", "Filter IGRA cases by actual station distance", numberOption("--max-station-distance-km"))
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = verificationIndexSkillResultSchema.parse(
        await new VerificationIndexSkillService().summarize({
          referenceDataset: parseReference(options.reference),
          latitude: options.lat,
          longitude: options.lon,
          startTime: options.from,
          endTime: options.to,
          cycleHoursUtc: parseCycles(options.cycles),
          leadHours: parseNumberList(options.leadHours, "--lead-hours"),
          variables: parseStringList(options.vars),
          pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
          ...(options.months === undefined ? {} : { monthsUtc: parseNumberList(options.months, "--months") }),
          ...(options.grid === undefined ? {} : { gfsGrid: options.grid }),
          ...(options.station === undefined ? {} : { stationId: options.station }),
          ...(options.maxStationDistanceKm === undefined
            ? {}
            : { maxStationDistanceKm: options.maxStationDistanceKm }),
        }),
      );
      print(result, Boolean(options.json));
    });
}

function assertAnalysisDataset(value: unknown): void {
  if (String(value).trim().toLowerCase() !== "gfs-analysis") {
    throw new InvalidRequestError(`Indexing currently supports only --dataset gfs-analysis, received: ${value}`);
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
    throw new InvalidRequestError("Expected --cycles to contain only 0,6,12,18");
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

function parseReference(value: unknown): "gfs-analysis" | "igra" {
  const reference = String(value).trim().toLowerCase();
  if (reference === "gfs-analysis" || reference === "igra") return reference;
  throw new InvalidRequestError(`Expected --reference gfs-analysis|igra, received: ${value}`);
}

function parseStringList(value: unknown): string[] {
  const values = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) throw new InvalidRequestError("Expected a non-empty comma-separated list");
  return values;
}

