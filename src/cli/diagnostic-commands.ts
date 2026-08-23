import type { Command } from "commander";
import { LayerDiagnosticsService } from "../core/layer-diagnostics.js";
import { ParcelDiagnosticsService } from "../core/parcel-diagnostics.js";
import { ProfileDiagnosticsService } from "../core/profile-diagnostics.js";
import type { ParcelDefinitionId, ProfileSourceId } from "../schema/query.js";
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
}
