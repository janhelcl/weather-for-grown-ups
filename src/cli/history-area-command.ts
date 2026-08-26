import type { Command } from "commander";
import type {
  HistoricalAreaFieldId,
  HistoricalAreaPressureVariableId,
} from "../catalog/history-area.js";
import { HistoricalAreaSummaryService } from "../core/history-area-summary.js";
import type { AreaThreshold } from "../schema/area-summary.js";
import {
  historicalAreaSummaryResultSchema,
  type HistoricalAreaSummaryQueryInput,
} from "../schema/history-area-summary.js";

export function registerHistoryAreaCommand(program: Command): void {
  program
    .command("history-area")
    .description("Summarize one raw historical GFS analysis field over a native NCEI bbox grid subset")
    .requiredOption("--west <number>", "Western longitude", Number)
    .requiredOption("--east <number>", "Eastern longitude", Number)
    .requiredOption("--south <number>", "Southern latitude", Number)
    .requiredOption("--north <number>", "Northern latitude", Number)
    .requiredOption("--at <iso>", "Historical GFS analysis cycle at 00,06,12,18 UTC")
    .option("--var <id>", "One raw historical pressure-level variable; use together with --level")
    .option("--level <hpa>", "Pressure level in hPa; use together with --var", Number)
    .option("--field <id>", "One raw historical non-isobaric field; mutually exclusive with --var/--level")
    .option("--percentiles <list>", "Comma-separated spatial percentiles in [0,100]")
    .option("--gte <number>", "Spatial fraction of defined grid cells >= threshold; repeatable", collectGte)
    .option("--lte <number>", "Spatial fraction of defined grid cells <= threshold; repeatable", collectLte)
    .option("--extrema-locations", "Include representative min/max grid coordinates and tie counts")
    .option("--max-grid-points <number>", "Maximum estimated 0.5-degree grid cells", Number)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const thresholds = [
        ...((options.gte ?? []) as AreaThreshold[]),
        ...((options.lte ?? []) as AreaThreshold[]),
      ];
      const query: HistoricalAreaSummaryQueryInput = {
        westLongitude: options.west,
        eastLongitude: options.east,
        southLatitude: options.south,
        northLatitude: options.north,
        analysisTime: options.at,
        ...(options.var === undefined
          ? {}
          : { variable: options.var as HistoricalAreaPressureVariableId }),
        ...(options.level === undefined ? {} : { pressureLevelHpa: options.level }),
        ...(options.field === undefined ? {} : { field: options.field as HistoricalAreaFieldId }),
        ...(options.percentiles === undefined
          ? {}
          : { percentiles: parseNumberList(options.percentiles) }),
        ...(thresholds.length === 0 ? {} : { thresholds }),
        includeExtremaLocations: Boolean(options.extremaLocations),
        ...(options.maxGridPoints === undefined ? {} : { maxGridPoints: options.maxGridPoints }),
      };

      const result = historicalAreaSummaryResultSchema.parse(
        await new HistoricalAreaSummaryService().summarize(query),
      );
      if (options.json) return console.log(JSON.stringify(result, null, 2));

      console.log(`Historical GFS Grid 4 analysis ${result.analysisTime}`);
      if (result.variable) {
        console.log(`${result.variable.id} ${result.variable.pressureHpa} hPa [${result.variable.unit}]`);
      } else if (result.field) {
        console.log(`${result.field.id} [${result.field.output.unit}]`);
        console.dir({ level: result.field.level, temporal: result.field.temporal }, { depth: null });
      }
      console.table([result.statistics]);
      if (result.distribution) console.dir(result.distribution, { depth: null });
      console.log(result.caveat);
    });
}

function parseNumberList(value: unknown): number[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean).map(Number);
}

function collectGte(value: string, previous: AreaThreshold[] | undefined): AreaThreshold[] {
  return collectThreshold("gte", value, previous);
}

function collectLte(value: string, previous: AreaThreshold[] | undefined): AreaThreshold[] {
  return collectThreshold("lte", value, previous);
}

function collectThreshold(
  operator: AreaThreshold["operator"],
  value: string,
  previous: AreaThreshold[] | undefined,
): AreaThreshold[] {
  const threshold = Number(value);
  if (!Number.isFinite(threshold)) throw new Error(`Expected numeric threshold, received: ${value}`);
  return [...(previous ?? []), { operator, value: threshold }];
}
