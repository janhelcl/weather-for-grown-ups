import type { Command } from "commander";
import { HistoricalPointsTimeSeriesService } from "../core/history-points-timeseries.js";
import { HistoricalPointsService } from "../core/history-points.js";
import type { HistoricalGfsFieldId } from "../schema/history-fields.js";
import {
  DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS,
  HISTORICAL_GFS_CYCLE_HOURS_UTC,
  type HistoricalGfsVariableId,
} from "../schema/history.js";
import { historicalPointsTimeSeriesResultSchema } from "../schema/history-points-timeseries.js";
import { historicalPointsResultSchema } from "../schema/history-points.js";
import type { PointCoordinate } from "../schema/query.js";
import { parseHistoryCycles } from "./history-command.js";
import { collectPoint, parseLevels } from "./shared.js";

export function registerHistoryPointsCommand(program: Command): void {
  program
    .command("history-points")
    .description("Fetch one historical GFS analysis selection across multiple points")
    .requiredOption("--point <lat,lon>", "Point to sample; repeat up to 10 times", collectPoint)
    .requiredOption("--at <iso>", "Historical GFS analysis cycle at 00,06,12,18 UTC")
    .option("--vars <list>", "Comma-separated historical pressure variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated historical non-isobaric fields")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const points = options.point as PointCoordinate[];
      const variables = options.vars === undefined ? undefined : parseVariables(options.vars);
      const pressureLevelsHpa = options.levels === undefined ? undefined : parseLevels(options.levels);
      const fields = options.fields === undefined ? undefined : parseFields(options.fields);

      const result = historicalPointsResultSchema.parse(await new HistoricalPointsService().getPoints({
        points,
        analysisTime: options.at,
        ...(variables ? { variables } : {}),
        ...(pressureLevelsHpa ? { pressureLevelsHpa } : {}),
        ...(fields ? { fields } : {}),
      }));

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS Grid 4 analysis ${result.analysisTime}; ${result.points.length} points`);
      console.log(`Source ${result.source.provider} (${result.source.access}); ${result.source.composition}`);
      for (const [index, point] of result.points.entries()) {
        console.log(`Point ${index + 1}: ${point.requestedPoint.latitude},${point.requestedPoint.longitude} → grid ${point.gridPoint.latitude},${point.gridPoint.longitude} (${point.cacheHit ? "cache" : "upstream"})`);
        if (point.levels) console.table(point.levels);
        if (point.fields) console.dir(point.fields, { depth: null });
      }
      console.log(result.caveat);
    });

  program
    .command("history-points-timeseries")
    .description("Track one historical GFS analysis selection across multiple points and analysis cycles")
    .requiredOption("--point <lat,lon>", "Point to sample; repeat up to 10 times", collectPoint)
    .requiredOption("--from <iso>", "Inclusive start of historical range")
    .requiredOption("--to <iso>", "Inclusive end of historical range")
    .option("--cycles <list>", "Comma-separated UTC analysis hours: 0,6,12,18", HISTORICAL_GFS_CYCLE_HOURS_UTC.join(","))
    .option("--vars <list>", "Comma-separated historical pressure variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated historical non-isobaric fields")
    .option("--max-steps <number>", "Maximum selected analysis cycles", Number, DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS)
    .option("--max-point-steps <number>", "Maximum points × analysis cycles", Number, 32)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const points = options.point as PointCoordinate[];
      const variables = options.vars === undefined ? undefined : parseVariables(options.vars);
      const pressureLevelsHpa = options.levels === undefined ? undefined : parseLevels(options.levels);
      const fields = options.fields === undefined ? undefined : parseFields(options.fields);

      const result = historicalPointsTimeSeriesResultSchema.parse(
        await new HistoricalPointsTimeSeriesService().getPointsTimeSeries({
          points,
          startTime: options.from,
          endTime: options.to,
          cycleHoursUtc: parseHistoryCycles(options.cycles),
          ...(variables ? { variables } : {}),
          ...(pressureLevelsHpa ? { pressureLevelsHpa } : {}),
          ...(fields ? { fields } : {}),
          maxSteps: options.maxSteps,
          maxPointSteps: options.maxPointSteps,
        }),
      );

      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Historical GFS analyses ${result.requestedStartTime} → ${result.requestedEndTime}; ${points.length} points × ${result.series.length} steps`);
      console.log(`Source ${result.source.provider} (${result.source.access}); ${result.source.composition}`);
      for (const step of result.series) {
        console.log(`\n${step.analysisTime}`);
        for (const [index, point] of step.points.entries()) {
          console.log(`Point ${index + 1}: ${point.requestedPoint.latitude},${point.requestedPoint.longitude} → grid ${point.gridPoint.latitude},${point.gridPoint.longitude} (${point.cacheHit ? "cache" : "upstream"})`);
          if (point.levels) console.table(point.levels);
          if (point.fields) console.dir(point.fields, { depth: null });
        }
      }
      console.log(result.caveat);
    });
}

function parseVariables(value: unknown): HistoricalGfsVariableId[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean) as HistoricalGfsVariableId[];
}

function parseFields(value: unknown): HistoricalGfsFieldId[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean) as HistoricalGfsFieldId[];
}
