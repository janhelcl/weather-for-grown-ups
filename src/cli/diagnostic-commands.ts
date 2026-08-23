import type { Command } from "commander";
import { DiagnosticTimeSeriesService } from "../core/diagnostic-time-series.js";
import { LayerDiagnosticsService } from "../core/layer-diagnostics.js";
import { ParcelDiagnosticsService } from "../core/parcel-diagnostics.js";
import { ProfileDiagnosticsService } from "../core/profile-diagnostics.js";
import type { DiagnosticTimeSeriesQueryInput } from "../schema/diagnostic-time-series.js";
import {
  diagnosticTimeSeriesResultSchema,
  type DiagnosticTimeSeriesResult,
} from "../schema/diagnostic-time-series-result.js";
import {
  DEFAULT_TIME_SERIES_MAX_STEPS,
  type ParcelDefinitionId,
  type ProfileSourceId,
} from "../schema/query.js";
import {
  layerDiagnosticsResultSchema,
  parcelDiagnosticsResultSchema,
  profileDiagnosticsResultSchema,
} from "../schema/result.js";
import {
  DEFAULT_LAYER_DIAGNOSTICS,
  DEFAULT_PROFILE_DIAGNOSTICS,
  RUN_HELP,
  parseLayerDiagnostics,
  parseLevels,
  parseProfileDiagnostics,
} from "./shared.js";

export function registerDiagnosticCommands(program: Command): void {
  program
    .command("layer")
    .description("Derive deterministic diagnostics across two GFS pressure surfaces")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .requiredOption("--lower <hpa>", "Lower-altitude pressure surface in hPa", Number)
    .requiredOption("--upper <hpa>", "Upper-altitude pressure surface in hPa", Number)
    .option("--diagnostics <list>", "Comma-separated layer diagnostic IDs", DEFAULT_LAYER_DIAGNOSTICS)
    .option("--source <nomads|s3>", "Data access path", "nomads")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await new LayerDiagnosticsService().getLayerDiagnostics({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        validTime: options.valid,
        lowerPressureHpa: options.lower,
        upperPressureHpa: options.upper,
        diagnostics: parseLayerDiagnostics(options.diagnostics),
        source: options.source as ProfileSourceId,
      });
      layerDiagnosticsResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`Source ${result.source.provider} (${result.source.access})`);
      console.log(`${result.layer.lowerPressureHpa} → ${result.layer.upperPressureHpa} hPa; ${result.layer.lowerGeopotentialHeightGpm.toFixed(0)} → ${result.layer.upperGeopotentialHeightGpm.toFixed(0)} gpm; depth ${result.layer.depthGpm.toFixed(0)} gpm`);
      console.table(result.diagnostics.map((diagnostic) => ({ id: diagnostic.id, ...diagnostic.values })));
      console.log("Raw endpoint values used by the derivations");
      console.table(result.levels);
    });

  program
    .command("profile-diagnostics")
    .description("Derive freezing-level crossings and inversion layers from an explicit GFS pressure profile")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .requiredOption("--levels <list>", "Comma-separated published pressure levels in hPa; vertical resolution controls diagnostic resolution")
    .option("--diagnostics <list>", "Comma-separated profile diagnostic IDs", DEFAULT_PROFILE_DIAGNOSTICS)
    .option("--source <nomads|s3>", "Data access path", "nomads")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await new ProfileDiagnosticsService().getProfileDiagnostics({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        validTime: options.valid,
        pressureLevelsHpa: parseLevels(options.levels),
        diagnostics: parseProfileDiagnostics(options.diagnostics),
        source: options.source as ProfileSourceId,
      });
      profileDiagnosticsResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`Source ${result.source.provider} (${result.source.access})`);
      console.log(`Sampled pressure levels (hPa): ${result.sampledPressureLevelsHpa.join(", ")}`);
      for (const diagnostic of result.diagnostics) {
        console.log(diagnostic.id);
        if (diagnostic.id === "freezing_level_crossings") console.dir(diagnostic.crossings, { depth: null });
        else console.table(diagnostic.layers);
      }
      console.log("Raw sampled levels used by the derivations");
      console.table(result.levels);
    });

  program
    .command("parcel")
    .description("Lift an explicit parcel through a sampled GFS pressure profile and derive LCL/LFC/EL/CAPE/CIN")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .requiredOption("--levels <list>", "Comma-separated published pressure levels in hPa; vertical resolution controls parcel diagnostics")
    .requiredOption("--parcel <surface_2m|mixed_layer_100hpa|most_unstable_300hpa>", "Explicit parcel initialization")
    .option("--source <nomads|s3>", "Data access path", "nomads")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await new ParcelDiagnosticsService().getParcelDiagnostics({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        validTime: options.valid,
        pressureLevelsHpa: parseLevels(options.levels),
        parcel: options.parcel as ParcelDefinitionId,
        source: options.source as ProfileSourceId,
      });
      parcelDiagnosticsResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`Source ${result.source.provider} (${result.source.access})`);
      console.log(`Parcel ${result.parcel.startingState.definition} from ${result.parcel.startingState.pressureHpa.toFixed(1)} hPa, ${result.parcel.startingState.temperatureC.toFixed(2)} °C`);
      console.log(`LCL ${result.parcel.lcl.pressureHpa.toFixed(1)} hPa${result.parcel.lcl.geopotentialHeightGpm === undefined ? "" : ` / ${result.parcel.lcl.geopotentialHeightGpm.toFixed(0)} gpm`}`);
      console.log(`LFC ${result.parcel.lfc ? `${result.parcel.lfc.pressureHpa.toFixed(1)} hPa` : "none"}; EL ${result.parcel.el ? `${result.parcel.el.pressureHpa.toFixed(1)} hPa` : "none"}`);
      console.log(`CAPE ${result.parcel.capeJkg.toFixed(1)} J/kg (${result.parcel.capeTop}); CIN ${result.parcel.cinJkg.toFixed(1)} J/kg (${result.parcel.cinTop})`);
      console.log("Parcel path");
      console.table(result.parcel.parcelPath);
      console.log("Raw sampled environmental levels");
      console.table(result.levels);
    });

  program
    .command("diagnostic-timeseries")
    .description("Evaluate layer, whole-profile, or parcel diagnostics across native GFS forecast times")
    .requiredOption("--kind <layer|profile|parcel>", "Diagnostic family")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--start <iso>", "Inclusive start of valid-time range")
    .requiredOption("--end <iso>", "Inclusive end of valid-time range")
    .option("--lower <hpa>", "Layer lower-altitude pressure surface in hPa", Number)
    .option("--upper <hpa>", "Layer upper-altitude pressure surface in hPa", Number)
    .option("--levels <list>", "Profile/parcel published pressure levels in hPa")
    .option("--diagnostics <list>", "Comma-separated diagnostic IDs; defaults depend on --kind")
    .option("--parcel <surface_2m|mixed_layer_100hpa|most_unstable_300hpa>", "Parcel initialization for --kind parcel")
    .option("--source <nomads|s3>", "Data access path", "s3")
    .option("--max-steps <number>", "Maximum native GFS outputs", Number, DEFAULT_TIME_SERIES_MAX_STEPS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const query: DiagnosticTimeSeriesQueryInput = {
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        startTime: options.start,
        endTime: options.end,
        diagnostic: diagnosticSelectionFromCli(options),
        source: options.source as ProfileSourceId,
        maxSteps: options.maxSteps,
      };
      const result = await new DiagnosticTimeSeriesService().getDiagnosticTimeSeries(query);
      diagnosticTimeSeriesResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      printDiagnosticTimeSeries(result);
    });
}

function diagnosticSelectionFromCli(options: Record<string, unknown>): DiagnosticTimeSeriesQueryInput["diagnostic"] {
  switch (options.kind) {
    case "layer":
      return {
        kind: "layer",
        lowerPressureHpa: Number(options.lower),
        upperPressureHpa: Number(options.upper),
        diagnostics: parseLayerDiagnostics(options.diagnostics ?? DEFAULT_LAYER_DIAGNOSTICS),
      };
    case "profile":
      return {
        kind: "profile",
        pressureLevelsHpa: parseLevels(options.levels ?? ""),
        diagnostics: parseProfileDiagnostics(options.diagnostics ?? DEFAULT_PROFILE_DIAGNOSTICS),
      };
    case "parcel":
      return {
        kind: "parcel",
        pressureLevelsHpa: parseLevels(options.levels ?? ""),
        parcel: String(options.parcel ?? "") as ParcelDefinitionId,
      };
    default:
      throw new Error(`Expected --kind layer, profile, or parcel; received ${String(options.kind)}`);
  }
}

function printDiagnosticTimeSeries(result: DiagnosticTimeSeriesResult): void {
  console.log(`GFS ${result.run}  ${result.requestedStartTime} → ${result.requestedEndTime}`);
  console.log(`Source ${result.source.provider} (${result.source.access}); ${result.series.length} native outputs`);

  switch (result.diagnostic.kind) {
    case "layer":
      console.table(result.series.map((step) => {
        if (step.kind !== "layer") throw new Error("Unexpected diagnostic step kind");
        const values = Object.fromEntries(step.diagnostics.flatMap((diagnostic) =>
          Object.entries(diagnostic.values).map(([field, value]) => [`${diagnostic.id}.${field}`, value])));
        return { validTime: step.validTime, forecastHour: step.forecastHour, ...values };
      }));
      break;
    case "profile":
      console.table(result.series.map((step) => {
        if (step.kind !== "profile") throw new Error("Unexpected diagnostic step kind");
        const freezingCrossings = step.diagnostics.reduce(
          (count, diagnostic) => count + (diagnostic.id === "freezing_level_crossings" ? diagnostic.crossings.length : 0),
          0,
        );
        const inversionLayers = step.diagnostics.reduce(
          (count, diagnostic) => count + (diagnostic.id === "temperature_inversion_layers" ? diagnostic.layers.length : 0),
          0,
        );
        return { validTime: step.validTime, forecastHour: step.forecastHour, freezingCrossings, inversionLayers };
      }));
      break;
    case "parcel":
      console.table(result.series.map((step) => {
        if (step.kind !== "parcel") throw new Error("Unexpected diagnostic step kind");
        return {
          validTime: step.validTime,
          forecastHour: step.forecastHour,
          capeJkg: step.parcel.capeJkg,
          cinJkg: step.parcel.cinJkg,
          lclPressureHpa: step.parcel.lcl.pressureHpa,
          lclHeightGpm: step.parcel.lcl.geopotentialHeightGpm,
          lfcPressureHpa: step.parcel.lfc?.pressureHpa,
          elPressureHpa: step.parcel.el?.pressureHpa,
        };
      }));
      break;
  }
}
