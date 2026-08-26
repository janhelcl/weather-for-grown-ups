import type { Command } from "commander";
import { PARCEL_DEFINITION_IDS, type ParcelDefinitionId } from "../catalog/parcel-diagnostics.js";
import { HistoricalParcelTimeSeriesService } from "../core/history-parcel-timeseries.js";
import { HistoricalParcelService } from "../core/history-parcel.js";
import {
  DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS,
  HISTORICAL_GFS_CYCLE_HOURS_UTC,
} from "../schema/history.js";
import {
  historicalParcelResultSchema,
  historicalParcelTimeSeriesResultSchema,
  type HistoricalParcelResult,
} from "../schema/history-parcel.js";
import { parseHistoryCycles } from "./history-command.js";
import { parseLevels } from "./shared.js";

const DEFAULT_HISTORY_CYCLES = HISTORICAL_GFS_CYCLE_HOURS_UTC.join(",");

export function registerHistoryParcelCommands(program: Command): void {
  program
    .command("history-parcel")
    .description("Derive parcel diagnostics from one historical GFS Grid 4 analysis")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--at <iso>", "Historical GFS analysis cycle at 00,06,12,18 UTC")
    .requiredOption("--levels <list>", "Comma-separated pressure levels in hPa forming the historical sounding")
    .requiredOption("--parcel <surface_2m|mixed_layer_100hpa|most_unstable_300hpa>", "Explicit parcel initialization")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = historicalParcelResultSchema.parse(await new HistoricalParcelService().getHistoricalParcel({
        latitude: options.lat,
        longitude: options.lon,
        analysisTime: options.at,
        pressureLevelsHpa: parseLevels(options.levels),
        parcel: parseParcel(options.parcel),
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      printParcel(result.analysisTime, result.parcel);
      console.log(`Grid ${result.gridPoint.latitude},${result.gridPoint.longitude}; ${result.source.cacheHit ? "cache" : "upstream"}`);
      console.log(result.caveat);
    });

  program
    .command("history-parcel-timeseries")
    .description("Derive parcel diagnostics across a bounded series of historical GFS analyses")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--from <iso>", "Inclusive start of historical range")
    .requiredOption("--to <iso>", "Inclusive end of historical range")
    .requiredOption("--levels <list>", "Comma-separated pressure levels in hPa forming each historical sounding")
    .requiredOption("--parcel <surface_2m|mixed_layer_100hpa|most_unstable_300hpa>", "Explicit parcel initialization")
    .option("--cycles <list>", "Comma-separated UTC analysis hours: 0,6,12,18", DEFAULT_HISTORY_CYCLES)
    .option("--max-steps <number>", "Maximum selected analysis cycles", Number, DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = historicalParcelTimeSeriesResultSchema.parse(
        await new HistoricalParcelTimeSeriesService().getHistoricalParcelTimeSeries({
          latitude: options.lat,
          longitude: options.lon,
          startTime: options.from,
          endTime: options.to,
          pressureLevelsHpa: parseLevels(options.levels),
          parcel: parseParcel(options.parcel),
          cycleHoursUtc: parseHistoryCycles(options.cycles),
          maxSteps: options.maxSteps,
        }),
      );
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Historical parcel ${result.requestedStartTime} → ${result.requestedEndTime}`);
      for (const step of result.series) {
        printParcel(step.analysisTime, step.parcel);
        console.log(step.cacheHit ? "cache" : "upstream");
      }
      console.log(result.caveat);
    });
}

function parseParcel(value: unknown): ParcelDefinitionId {
  const id = String(value) as ParcelDefinitionId;
  if (!PARCEL_DEFINITION_IDS.includes(id)) {
    throw new Error(`Expected --parcel from: ${PARCEL_DEFINITION_IDS.join(",")}`);
  }
  return id;
}

function printParcel(analysisTime: string, parcel: HistoricalParcelResult["parcel"]): void {
  console.log(`${analysisTime}  ${parcel.startingState.definition}`);
  console.log(`start ${parcel.startingState.pressureHpa.toFixed(1)} hPa / ${parcel.startingState.temperatureC.toFixed(2)} °C; LCL ${parcel.lcl.pressureHpa.toFixed(1)} hPa`);
  console.log(`LFC ${parcel.lfc ? `${parcel.lfc.pressureHpa.toFixed(1)} hPa` : "none"}; EL ${parcel.el ? `${parcel.el.pressureHpa.toFixed(1)} hPa` : "none"}; CAPE ${parcel.capeJkg.toFixed(1)} J/kg; CIN ${parcel.cinJkg.toFixed(1)} J/kg`);
}
