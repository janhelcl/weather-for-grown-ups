import type { Command } from "commander";
import { AreaSummaryService } from "../core/area-summary.js";
import { areaSummaryResultSchema } from "../schema/area-summary-result.js";
import type { AreaThreshold, AreaSummaryQueryInput } from "../schema/area-summary.js";
import type { NonIsobaricFieldId, RawVariableId } from "../schema/query.js";
import { RUN_HELP } from "./shared.js";

export function registerAreaCommand(program: Command): void {
  program
    .command("area")
    .description("Summarize one raw GFS pressure-level variable or non-isobaric field over a bounded area")
    .requiredOption("--west <number>", "Western longitude", Number)
    .requiredOption("--east <number>", "Eastern longitude", Number)
    .requiredOption("--south <number>", "Southern latitude", Number)
    .requiredOption("--north <number>", "Northern latitude", Number)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .option("--var <id>", "One raw pressure-level variable; use together with --level")
    .option("--level <hpa>", "Pressure level in hPa; use together with --var", Number)
    .option("--field <id>", "One raw non-isobaric field; mutually exclusive with --var/--level")
    .option("--percentiles <list>", "Comma-separated percentiles in [0,100], evaluated over defined grid cells")
    .option("--gte <number>", "Fraction of defined grid cells >= threshold in normalized output units; repeatable", collectGte)
    .option("--lte <number>", "Fraction of defined grid cells <= threshold in normalized output units; repeatable", collectLte)
    .option("--extrema-locations", "Return representative min/max grid coordinates plus tie counts")
    .option("--max-grid-points <number>", "Maximum estimated GFS grid points", Number, 50000)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const thresholds = [
        ...((options.gte ?? []) as AreaThreshold[]),
        ...((options.lte ?? []) as AreaThreshold[]),
      ];
      const query: AreaSummaryQueryInput = {
        westLongitude: options.west,
        eastLongitude: options.east,
        southLatitude: options.south,
        northLatitude: options.north,
        run: options.run,
        validTime: options.valid,
        ...(options.var === undefined ? {} : { variable: options.var as RawVariableId }),
        ...(options.level === undefined ? {} : { pressureLevelHpa: options.level as number }),
        ...(options.field === undefined ? {} : { field: options.field as NonIsobaricFieldId }),
        ...(options.percentiles === undefined ? {} : { percentiles: parseNumberList(options.percentiles) }),
        ...(thresholds.length === 0 ? {} : { thresholds }),
        includeExtremaLocations: Boolean(options.extremaLocations),
        maxGridPoints: options.maxGridPoints,
      };
      const result = areaSummaryResultSchema.parse(await new AreaSummaryService().summarize(query));
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      if (result.variable) {
        console.log(`${result.variable.id} ${result.variable.pressureHpa} hPa [${result.variable.unit}]`);
      } else if (result.field) {
        console.log(`${result.field.id} [${result.field.output.unit}]`);
        console.dir({ level: result.field.level, temporal: result.field.temporal }, { depth: null });
      }
      console.table([result.statistics]);
      if (result.distribution) console.dir(result.distribution, { depth: null });
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
