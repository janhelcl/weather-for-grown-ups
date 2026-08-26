import type { Command } from "commander";
import { LAYER_DIAGNOSTIC_IDS, type LayerDiagnosticId } from "../catalog/layer-diagnostics.js";
import { PARCEL_DEFINITION_IDS, type ParcelDefinitionId } from "../catalog/parcel-diagnostics.js";
import { PROFILE_DIAGNOSTIC_IDS, type ProfileDiagnosticId } from "../catalog/profile-diagnostics.js";
import { HistoricalDiagnosticTimeSeriesService } from "../core/history-diagnostic-timeseries.js";
import { HistoricalDiagnosticsService } from "../core/history-diagnostics.js";
import {
  historicalLayerDiagnosticsResultSchema,
  historicalProfileDiagnosticsResultSchema,
} from "../schema/history-diagnostics.js";
import { historicalDiagnosticTimeSeriesResultSchema } from "../schema/history-diagnostic-timeseries.js";
import {
  DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS,
  HISTORICAL_GFS_CYCLE_HOURS_UTC,
} from "../schema/history.js";
import { parseHistoryCycles } from "./history-command.js";
import { parseLevels } from "./shared.js";

export function registerHistoryDiagnosticCommands(program: Command): void {
  program
    .command("history-layer-diagnostics")
    .description("Derive pressure-layer diagnostics from one historical GFS Grid 4 analysis")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--at <iso>", "Historical GFS analysis cycle at 00,06,12,18 UTC")
    .requiredOption("--lower <hpa>", "Lower-altitude pressure level in hPa", Number)
    .requiredOption("--upper <hpa>", "Upper-altitude pressure level in hPa", Number)
    .requiredOption("--diagnostics <list>", `Comma-separated diagnostics: ${LAYER_DIAGNOSTIC_IDS.join(",")}`)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const service = new HistoricalDiagnosticsService();
      const result = historicalLayerDiagnosticsResultSchema.parse(await service.getLayerDiagnostics({
        latitude: options.lat,
        longitude: options.lon,
        analysisTime: options.at,
        lowerPressureHpa: options.lower,
        upperPressureHpa: options.upper,
        diagnostics: parseLayerDiagnostics(options.diagnostics),
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Historical GFS layer diagnostics ${result.analysisTime}`);
      console.log(`${result.layer.lowerPressureHpa} → ${result.layer.upperPressureHpa} hPa (${result.layer.depthGpm} gpm)`);
      console.table(result.diagnostics.map((diagnostic) => ({ id: diagnostic.id, ...diagnostic.values })));
      console.log(result.caveat);
    });

  program
    .command("history-profile-diagnostics")
    .description("Derive whole-profile diagnostics from one historical GFS Grid 4 analysis")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--at <iso>", "Historical GFS analysis cycle at 00,06,12,18 UTC")
    .requiredOption("--levels <list>", "Comma-separated pressure levels in hPa")
    .requiredOption("--diagnostics <list>", `Comma-separated diagnostics: ${PROFILE_DIAGNOSTIC_IDS.join(",")}`)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const service = new HistoricalDiagnosticsService();
      const result = historicalProfileDiagnosticsResultSchema.parse(await service.getProfileDiagnostics({
        latitude: options.lat,
        longitude: options.lon,
        analysisTime: options.at,
        pressureLevelsHpa: parseLevels(options.levels),
        diagnostics: parseProfileDiagnostics(options.diagnostics),
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Historical GFS profile diagnostics ${result.analysisTime}`);
      for (const diagnostic of result.diagnostics) {
        console.log(`\n${diagnostic.id}`);
        if (diagnostic.id === "freezing_level_crossings") console.table(diagnostic.crossings);
        else console.table(diagnostic.layers);
      }
      console.log(result.caveat);
    });

  program
    .command("history-diagnostic-timeseries")
    .description("Evaluate one layer, profile, or parcel diagnostic across historical GFS analysis cycles")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--from <iso>", "Inclusive start of historical range")
    .requiredOption("--to <iso>", "Inclusive end of historical range")
    .requiredOption("--kind <kind>", "Diagnostic kind: layer|profile|parcel")
    .option("--lower <hpa>", "Layer lower-altitude pressure level in hPa", Number)
    .option("--upper <hpa>", "Layer upper-altitude pressure level in hPa", Number)
    .option("--diagnostics <list>", "Comma-separated layer/profile diagnostic IDs")
    .option("--levels <list>", "Comma-separated pressure levels for profile/parcel diagnostics")
    .option("--parcel <id>", `Parcel definition: ${PARCEL_DEFINITION_IDS.join(",")}`)
    .option("--cycles <list>", "Comma-separated UTC analysis hours: 0,6,12,18", HISTORICAL_GFS_CYCLE_HOURS_UTC.join(","))
    .option("--max-steps <number>", "Maximum selected analysis cycles", Number, DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const diagnostic = parseHistoricalDiagnosticSelection(options);
      const service = new HistoricalDiagnosticTimeSeriesService();
      const result = historicalDiagnosticTimeSeriesResultSchema.parse(await service.getDiagnosticTimeSeries({
        latitude: options.lat,
        longitude: options.lon,
        startTime: options.from,
        endTime: options.to,
        diagnostic,
        cycleHoursUtc: parseHistoryCycles(options.cycles),
        maxSteps: options.maxSteps,
      }));

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Historical GFS ${result.diagnostic.kind} diagnostics ${result.requestedStartTime} → ${result.requestedEndTime}`);
      console.log(`Cycles UTC: ${result.cycleHoursUtc.map((hour) => String(hour).padStart(2, "0")).join(", ")}`);
      for (const step of result.series) {
        console.log(`\n${step.analysisTime} (${step.cacheHit ? "cache" : "upstream"})`);
        if (step.kind === "layer") console.table(step.diagnostics.map((item) => ({ id: item.id, ...item.values })));
        else if (step.kind === "profile") console.dir(step.diagnostics, { depth: null });
        else console.table([{
          capeJkg: step.parcel.capeJkg,
          cinJkg: step.parcel.cinJkg,
          lclPressureHpa: step.parcel.lcl.pressureHpa,
          lfcPressureHpa: step.parcel.lfc?.pressureHpa,
          elPressureHpa: step.parcel.el?.pressureHpa,
        }]);
      }
      console.log(result.caveat);
    });
}

function parseHistoricalDiagnosticSelection(options: Record<string, unknown>) {
  const kind = String(options.kind).trim().toLowerCase();
  if (kind === "layer") {
    if (options.lower === undefined || options.upper === undefined || options.diagnostics === undefined) {
      throw new Error("Layer diagnostic time series requires --lower, --upper, and --diagnostics");
    }
    return {
      kind: "layer" as const,
      lowerPressureHpa: Number(options.lower),
      upperPressureHpa: Number(options.upper),
      diagnostics: parseLayerDiagnostics(options.diagnostics),
    };
  }
  if (kind === "profile") {
    if (options.levels === undefined || options.diagnostics === undefined) {
      throw new Error("Profile diagnostic time series requires --levels and --diagnostics");
    }
    return {
      kind: "profile" as const,
      pressureLevelsHpa: parseLevels(options.levels),
      diagnostics: parseProfileDiagnostics(options.diagnostics),
    };
  }
  if (kind === "parcel") {
    if (options.levels === undefined || options.parcel === undefined) {
      throw new Error("Parcel diagnostic time series requires --levels and --parcel");
    }
    return {
      kind: "parcel" as const,
      pressureLevelsHpa: parseLevels(options.levels),
      parcel: parseParcel(options.parcel),
    };
  }
  throw new Error("Expected --kind layer|profile|parcel");
}

function parseParcel(value: unknown): ParcelDefinitionId {
  const id = String(value).trim() as ParcelDefinitionId;
  if (!PARCEL_DEFINITION_IDS.includes(id)) {
    throw new Error(`Expected parcel from: ${PARCEL_DEFINITION_IDS.join(",")}`);
  }
  return id;
}

function parseLayerDiagnostics(value: unknown): LayerDiagnosticId[] {
  const ids = String(value).split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.some((id) => !LAYER_DIAGNOSTIC_IDS.includes(id as LayerDiagnosticId))) {
    throw new Error(`Expected historical layer diagnostics from: ${LAYER_DIAGNOSTIC_IDS.join(",")}`);
  }
  return ids as LayerDiagnosticId[];
}

function parseProfileDiagnostics(value: unknown): ProfileDiagnosticId[] {
  const ids = String(value).split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.some((id) => !PROFILE_DIAGNOSTIC_IDS.includes(id as ProfileDiagnosticId))) {
    throw new Error(`Expected historical profile diagnostics from: ${PROFILE_DIAGNOSTIC_IDS.join(",")}`);
  }
  return ids as ProfileDiagnosticId[];
}
