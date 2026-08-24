import type { Command } from "commander";
import type { GefsPgrb2aFieldId } from "../catalog/gefs-fields.js";
import type { GefsPressureVariableId } from "../catalog/gefs.js";
import { AreaSummaryService } from "../core/area-summary.js";
import { GefsAreaSummaryService } from "../core/gefs-area-summary.js";
import { areaSummaryResultSchema } from "../schema/area-summary-result.js";
import type { AreaThreshold, AreaSummaryQueryInput } from "../schema/area-summary.js";
import { gefsAreaSummaryResultSchema, type GefsAreaSummaryQueryInput } from "../schema/gefs-area-summary.js";
import type { NonIsobaricFieldId, RawVariableId } from "../schema/query.js";
import { parseAtmosphericModel, parseGefsMembers, parseNumbers, RUN_HELP } from "./shared.js";

export function registerAreaCommand(program: Command): void {
  program
    .command("area")
    .description("Summarize one raw pressure-level variable or non-isobaric field over a bounded area for GFS or GEFS")
    .option("--model <gfs|gefs>", "Atmospheric model", "gfs")
    .requiredOption("--west <number>", "Western longitude", Number)
    .requiredOption("--east <number>", "Eastern longitude", Number)
    .requiredOption("--south <number>", "Southern latitude", Number)
    .requiredOption("--north <number>", "Northern latitude", Number)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .option("--var <id>", "One raw pressure-level variable; use together with --level")
    .option("--level <hpa>", "Pressure level in hPa; use together with --var", Number)
    .option("--field <id>", "One raw non-isobaric field; mutually exclusive with --var/--level")
    .option("--percentiles <list>", "Comma-separated spatial percentiles in [0,100], evaluated per model/member over defined grid cells")
    .option("--gte <number>", "Spatial fraction of defined grid cells >= threshold in normalized output units; repeatable", collectGte)
    .option("--lte <number>", "Spatial fraction of defined grid cells <= threshold in normalized output units; repeatable", collectLte)
    .option("--extrema-locations", "GFS: representative min/max locations; GEFS: min/max locations for every member")
    .option("--members <list>", "GEFS members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "GEFS quantiles across member-level spatial statistics", "0.1,0.5,0.9")
    .option("--include-members", "GEFS: include each member's complete spatial summary")
    .option("--max-grid-points <number>", "Maximum estimated grid points per model/member", Number)
    .option("--max-member-grid-points <number>", "GEFS: maximum estimated grid points × members", Number)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const model = parseAtmosphericModel(options.model);
      const thresholds = [
        ...((options.gte ?? []) as AreaThreshold[]),
        ...((options.lte ?? []) as AreaThreshold[]),
      ];
      if (model === "gefs") {
        const query: GefsAreaSummaryQueryInput = {
          westLongitude: options.west,
          eastLongitude: options.east,
          southLatitude: options.south,
          northLatitude: options.north,
          run: options.run,
          validTime: options.valid,
          ...(options.var === undefined ? {} : { variable: options.var as GefsPressureVariableId }),
          ...(options.level === undefined ? {} : { pressureLevelHpa: options.level as number }),
          ...(options.field === undefined ? {} : { field: options.field as GefsPgrb2aFieldId }),
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles),
          ...(options.percentiles === undefined ? {} : { percentiles: parseNumberList(options.percentiles) }),
          ...(thresholds.length === 0 ? {} : { thresholds }),
          includeExtremaLocations: Boolean(options.extremaLocations),
          includeMembers: Boolean(options.includeMembers),
          ...(options.maxGridPoints === undefined ? {} : { maxGridPoints: options.maxGridPoints }),
          ...(options.maxMemberGridPoints === undefined ? {} : { maxMemberGridPoints: options.maxMemberGridPoints }),
        };
        const result = gefsAreaSummaryResultSchema.parse(await new GefsAreaSummaryService().summarize(query));
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
        console.log(`${result.selection.variable ?? result.selection.field} [${result.selection.unit}] — ${result.selection.members.length} members`);
        console.table([
          { statistic: "spatial mean", ...compactDistribution(result.statistics.mean) },
          { statistic: "spatial min", ...compactDistribution(result.statistics.min) },
          { statistic: "spatial max", ...compactDistribution(result.statistics.max) },
        ]);
        if (result.spatialPercentiles) console.dir(result.spatialPercentiles, { depth: null });
        if (result.spatialThresholdFractions) console.dir(result.spatialThresholdFractions, { depth: null });
        if (result.memberExtrema) console.dir(result.memberExtrema, { depth: null });
        if (result.members) console.dir(result.members, { depth: null });
        return;
      }

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
        ...(options.maxGridPoints === undefined ? {} : { maxGridPoints: options.maxGridPoints }),
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

function compactDistribution(distribution: {
  mean: number;
  populationStdDev: number;
  min: number;
  max: number;
}) {
  return {
    ensembleMean: distribution.mean,
    ensembleStdDev: distribution.populationStdDev,
    ensembleMin: distribution.min,
    ensembleMax: distribution.max,
  };
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
