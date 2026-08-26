import type { Command } from "commander";
import { HistoricalFieldsService } from "../core/history-fields.js";
import {
  HISTORICAL_GFS_FIELD_IDS,
  historicalFieldsResultSchema,
  type HistoricalGfsFieldId,
} from "../schema/history-fields.js";
import type { HistoricalGfsVariableId } from "../schema/history.js";
import { parseLevels } from "./shared.js";

export function registerHistoryFieldsCommand(program: Command): void {
  program
    .command("history-fields")
    .description("Fetch mixed pressure and non-isobaric fields from one historical GFS Grid 4 analysis")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .requiredOption("--at <iso>", "Historical GFS analysis cycle at 00,06,12,18 UTC")
    .requiredOption("--fields <list>", "Comma-separated historical non-isobaric fields")
    .option("--vars <list>", "Optional comma-separated historical pressure variables")
    .option("--levels <list>", "Pressure levels in hPa when --vars is supplied")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const variables = options.vars === undefined ? undefined : parseHistoryVariables(options.vars);
      const pressureLevelsHpa = options.levels === undefined ? undefined : parseLevels(options.levels);
      const service = new HistoricalFieldsService();
      const result = historicalFieldsResultSchema.parse(await service.getHistoricalFields({
        latitude: options.lat,
        longitude: options.lon,
        analysisTime: options.at,
        ...(variables ? { variables } : {}),
        ...(pressureLevelsHpa ? { pressureLevelsHpa } : {}),
        fields: parseHistoricalFields(options.fields),
      }));

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Historical GFS mixed fields ${result.analysisTime}`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      if (result.levels) console.table(result.levels);
      console.table(result.fields.map((field) => ({ id: field.id, level: formatLevel(field.level), ...field.values })));
      console.log(result.caveat);
    });
}

function parseHistoricalFields(value: unknown): HistoricalGfsFieldId[] {
  const ids = String(value).split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !HISTORICAL_GFS_FIELD_IDS.includes(id as HistoricalGfsFieldId))) {
    throw new Error(`Expected --fields from: ${HISTORICAL_GFS_FIELD_IDS.join(",")}`);
  }
  return ids as HistoricalGfsFieldId[];
}

function parseHistoryVariables(value: unknown): HistoricalGfsVariableId[] {
  return String(value).split(",").map((id) => id.trim()).filter(Boolean) as HistoricalGfsVariableId[];
}

function formatLevel(level: { type: string; heightM?: number; id?: string }): string {
  if (level.type === "height_above_ground_m") return `${level.heightM}m AGL`;
  if (level.type === "named_layer" || level.type === "named_level") return level.id ?? level.type;
  return level.type;
}
