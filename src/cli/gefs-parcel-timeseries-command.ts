import type { Command } from "commander";
import { GefsDiagnosticTimeSeriesService } from "../core/gefs-diagnostic-timeseries.js";
import {
  GEFS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS,
  gefsDiagnosticTimeSeriesResultSchema,
} from "../schema/gefs-diagnostic-timeseries.js";
import type { ParcelDefinitionId } from "../schema/query.js";
import { parseGefsMembers, parseLevels, parseNumbers } from "./shared.js";

export function registerGefsParcelTimeSeriesCommand(program: Command): void {
  program
    .command("ensemble-parcel-timeseries")
    .description("Track member-first GEFS parcel/LCL/LFC/EL/CAPE/CIN distributions across native three-hour forecast steps")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest>", "GEFS run initialization; latest resolves one cycle capable of covering the complete requested range", "latest")
    .requiredOption("--start <iso>", "First native three-hour GEFS valid time")
    .requiredOption("--end <iso>", "Last native three-hour GEFS valid time, inclusive")
    .requiredOption("--levels <list>", "Comma-separated common GEFS pgrb2a pressure levels used as the explicit environmental sounding")
    .requiredOption("--parcel <surface_2m|mixed_layer_100hpa|most_unstable_300hpa>", "Explicit parcel initialization")
    .option("--members <list>", "Comma-separated GEFS members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "Comma-separated quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--max-steps <number>", "Maximum native forecast steps accepted", Number, GEFS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = gefsDiagnosticTimeSeriesResultSchema.parse(
        await new GefsDiagnosticTimeSeriesService().getDiagnosticTimeSeries({
          latitude: options.lat,
          longitude: options.lon,
          run: options.run,
          startTime: options.start,
          endTime: options.end,
          diagnostic: {
            kind: "parcel",
            pressureLevelsHpa: parseLevels(options.levels),
            parcel: options.parcel as ParcelDefinitionId,
          },
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles),
          maxSteps: options.maxSteps,
        }),
      );
      if (options.json) return console.log(JSON.stringify(result, null, 2));

      if (result.selection.diagnostic.kind !== "parcel") throw new Error("Expected GEFS parcel time-series result");
      console.log(`GEFS ${result.run}  ${result.startTime} → ${result.endTime}  ${result.series.length} steps`);
      console.log(`${result.selection.members.length} members; parcel ${result.selection.diagnostic.parcel}; levels ${result.selection.diagnostic.pressureLevelsHpa.join(",")} hPa`);
      console.table(result.series.map((step) => {
        if (step.kind !== "parcel") throw new Error("Expected parcel step");
        return {
          validTime: step.validTime,
          forecastHour: step.forecastHour,
          capeMeanJkg: step.summary.capeJkg.mean,
          capeStdDevJkg: step.summary.capeJkg.populationStdDev,
          cinMeanJkg: step.summary.cinJkg.mean,
          lclMeanHpa: step.summary.lclPressureHpa.mean,
          lfcFraction: step.summary.lfc.membersWithBoundary.fraction,
          elFraction: step.summary.el.membersWithBoundary.fraction,
          allCacheHit: step.allCacheHit,
        };
      }));
      console.log("LFC/EL fractions are raw member fractions, not calibrated probabilities.");
    });
}
