import type { Command } from "commander";
import { HistoricalTransectService } from "../core/history-transect.js";
import type { HistoricalGfsFieldId } from "../schema/history-fields.js";
import type { HistoricalGfsVariableId } from "../schema/history.js";
import { historicalTransectResultSchema } from "../schema/history-transect.js";
import type { PointCoordinate } from "../schema/query.js";
import { parseLevels } from "./shared.js";

export function registerHistoryTransectCommand(program: Command): void {
  program
    .command("history-transect")
    .description("Sample a great-circle cross-section from one historical GFS Grid 4 analysis")
    .requiredOption("--start <lat,lon>", "Transect start coordinate", parsePoint)
    .requiredOption("--end <lat,lon>", "Transect end coordinate", parsePoint)
    .requiredOption("--at <iso>", "Historical GFS analysis cycle at 00,06,12,18 UTC")
    .option("--vars <list>", "Comma-separated historical pressure variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated historical non-isobaric fields")
    .option("--samples <number>", "Great-circle samples, 2-10", Number, 10)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const variables = options.vars === undefined ? undefined : parseVariables(options.vars);
      const pressureLevelsHpa = options.levels === undefined ? undefined : parseLevels(options.levels);
      const fields = options.fields === undefined ? undefined : parseFields(options.fields);
      const result = historicalTransectResultSchema.parse(await new HistoricalTransectService().getTransect({
        start: options.start,
        end: options.end,
        analysisTime: options.at,
        ...(variables ? { variables } : {}),
        ...(pressureLevelsHpa ? { pressureLevelsHpa } : {}),
        ...(fields ? { fields } : {}),
        samples: options.samples,
      }));

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS Grid 4 analysis ${result.analysisTime}; transect ${result.totalDistanceKm.toFixed(1)} km`);
      console.log(`Source ${result.source.provider} (${result.source.access}); ${result.source.composition}`);
      for (const sample of result.samples) {
        console.log(`\n#${sample.index} ${sample.distanceKm.toFixed(1)} km: ${sample.requestedPoint.latitude.toFixed(3)},${sample.requestedPoint.longitude.toFixed(3)} → grid ${sample.gridPoint.latitude},${sample.gridPoint.longitude}`);
        if (sample.levels) console.table(sample.levels);
        if (sample.fields) console.dir(sample.fields, { depth: null });
      }
      console.log(result.caveat);
    });
}

function parsePoint(value: string): PointCoordinate {
  const [lat, lon, ...rest] = value.split(",").map((part) => part.trim());
  if (rest.length > 0 || lat === undefined || lon === undefined) {
    throw new Error(`Expected lat,lon; received: ${value}`);
  }
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Expected numeric lat,lon; received: ${value}`);
  }
  return { latitude, longitude };
}

function parseVariables(value: unknown): HistoricalGfsVariableId[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean) as HistoricalGfsVariableId[];
}

function parseFields(value: unknown): HistoricalGfsFieldId[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean) as HistoricalGfsFieldId[];
}
