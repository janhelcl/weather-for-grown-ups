import type { Command } from "commander";
import { LAYER_DIAGNOSTIC_IDS, type LayerDiagnosticId } from "../catalog/layer-diagnostics.js";
import { PROFILE_DIAGNOSTIC_IDS, type ProfileDiagnosticId } from "../catalog/profile-diagnostics.js";
import { HistoricalDiagnosticsService } from "../core/history-diagnostics.js";
import {
  historicalLayerDiagnosticsResultSchema,
  historicalProfileDiagnosticsResultSchema,
} from "../schema/history-diagnostics.js";
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
