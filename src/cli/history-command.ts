import type { Command } from "commander";
import { HistoricalProfileService } from "../core/history.js";
import type { HistoricalGfsVariableId } from "../schema/history.js";
import { historicalProfileResultSchema } from "../schema/history-result.js";
import { DEFAULT_LEVELS, parseLevels } from "./shared.js";

const DEFAULT_HISTORY_VARIABLES = "temperature,relative_humidity,wind,geopotential_height";

export function registerHistoryCommand(program: Command): void {
  program
    .command("history")
    .description("Fetch a historical NOAA GFS Grid 4 analysis profile from the NCEI archive")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--at <iso>", "Exact historical GFS analysis cycle at 00, 06, 12, or 18 UTC")
    .option(
      "--vars <list>",
      "Comma-separated historical pressure variables",
      DEFAULT_HISTORY_VARIABLES,
    )
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
}

function parseHistoryVariables(value: unknown): HistoricalGfsVariableId[] {
  return String(value)
    .split(",")
    .map((variable) => variable.trim())
    .filter(Boolean) as HistoricalGfsVariableId[];
}
