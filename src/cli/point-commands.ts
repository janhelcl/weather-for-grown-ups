import type { Command } from "commander";
import { AtmosphericBatchPointsService } from "../core/atmospheric-batch-points-service.js";
import { AtmosphericProfileService } from "../core/atmospheric-profile-service.js";
import { AtmosphericRunComparisonService } from "../core/atmospheric-run-comparison-service.js";
import { AtmosphericTimeSeriesService } from "../core/atmospheric-timeseries-service.js";
import { LatestRunResolver } from "../core/latest-run.js";
import { PointsTimeSeriesService } from "../core/points-time-series.js";
import { gefsBatchPointsResultSchema } from "../schema/gefs-batch-points.js";
import { gefsEnsembleProfileResultSchema } from "../schema/gefs-ensemble-profile.js";
import { gefsEnsembleTimeSeriesResultSchema } from "../schema/gefs-ensemble-timeseries.js";
import { gefsRunComparisonResultSchema } from "../schema/gefs-run-comparison.js";
import type { PointCoordinate, ProfileSourceId } from "../schema/query.js";
import {
  batchPointsResultSchema,
  latestGfsRunResultSchema,
  pointsTimeSeriesResultSchema,
  profileResultSchema,
  timeSeriesResultSchema,
} from "../schema/result.js";
import { runComparisonResultSchema } from "../schema/run-comparison-result.js";
import {
  DEFAULT_GEFS_PROFILE_VARIABLES,
  DEFAULT_LEVELS,
  RUN_HELP,
  collectPoint,
  parseAtmosphericModel,
  parseGefsMembers,
  parseGefsVariables,
  parseLevels,
  parseNumbers,
  pointSelection,
} from "./shared.js";

export function registerPointCommands(program: Command): void {
  program
    .command("latest")
    .description("Resolve the latest complete GFS 0.25° run (published through f384)")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const run = await new LatestRunResolver().resolveLatestRun();
      const result = latestGfsRunResultSchema.parse({
        model: "gfs_0p25",
        run: run.toISOString(),
        completeness: "f384",
        discoverySource: "NOAA AWS Open Data",
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(result.run);
    });

  program
    .command("profile")
    .description("Fetch a pressure profile from GFS or GEFS; deterministic GFS remains the default model")
    .option("--model <gfs|gefs>", "Atmospheric model family", "gfs")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", "Model initialization; GEFS accepts latest or an explicit cycle", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "GFS-only comma-separated non-isobaric field IDs")
    .option("--source <nomads|s3>", "GFS-only data access path")
    .option("--members <list>", "GEFS-only comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "GEFS-only comma-separated quantiles from 0 to 1")
    .option("--include-members", "GEFS-only: include each member's complete selected profile")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const model = parseAtmosphericModel(options.model);
      const service = new AtmosphericProfileService();

      if (model === "gfs") {
        if (options.members !== undefined || options.quantiles !== undefined || options.includeMembers) {
          throw new Error("--members, --quantiles and --include-members are only valid with --model gefs");
        }
        const selection = pointSelection(options.vars, options.levels, options.fields);
        const result = profileResultSchema.parse(await service.getProfile({
          model: "gfs_0p25",
          query: {
            latitude: options.lat,
            longitude: options.lon,
            run: options.run,
            validTime: options.valid,
            ...selection,
            source: (options.source ?? "nomads") as ProfileSourceId,
          },
        }));
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
        console.log(`Source ${result.source.provider} (${result.source.access})`);
        console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
        if (result.levels.length > 0) console.table(result.levels);
        if (result.fields) console.dir(result.fields, { depth: null });
        return;
      }

      if (options.fields !== undefined || options.source !== undefined) {
        throw new Error("--fields and --source are deterministic GFS options and are not valid with --model gefs");
      }
      const result = gefsEnsembleProfileResultSchema.parse(await service.getProfile({
        model: "gefs_0p50",
        query: {
          latitude: options.lat,
          longitude: options.lon,
          run: options.run,
          validTime: options.valid,
          variables: parseGefsVariables(options.vars ?? DEFAULT_GEFS_PROFILE_VARIABLES),
          pressureLevelsHpa: parseLevels(options.levels ?? DEFAULT_LEVELS),
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles ?? "0.1,0.5,0.9"),
          includeMembers: Boolean(options.includeMembers),
        },
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`${result.selection.members.length} members; ${result.selection.variables.join(",")} @ ${result.selection.pressureLevelsHpa.join(",")} hPa`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      console.table(result.summaries.map((summary) => ({
        pressureLevelHpa: summary.pressureLevelHpa,
        variable: summary.variable,
        unit: summary.unit,
        mean: summary.mean,
        populationStdDev: summary.populationStdDev,
        min: summary.min,
        max: summary.max,
      })));
      if (result.members) {
        for (const member of result.members) {
          console.log(`${member.member}${member.cacheHit ? " (cache)" : ""}`);
          console.table(member.values);
        }
      }
    });

  program
    .command("points")
    .description("Fetch one atmospheric field at multiple points from GFS or GEFS")
    .option("--model <gfs|gefs>", "Atmospheric model family", "gfs")
    .requiredOption("--point <lat,lon>", "Point to sample; repeat as needed (GFS max 50, GEFS max 20)", collectPoint)
    .option("--run <iso|latest|latest_complete>", "Model initialization; GEFS accepts latest or an explicit cycle", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .option("--vars <list>", "Pressure-level variables; GEFS requires exactly one")
    .option("--levels <list>", "Pressure levels in hPa; GEFS requires exactly one")
    .option("--fields <list>", "GFS-only comma-separated non-isobaric field IDs")
    .option("--members <list>", "GEFS-only comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "GEFS-only comma-separated quantiles from 0 to 1")
    .option("--gte <number>", "GEFS-only threshold in normalized output units", Number)
    .option("--include-members", "GEFS-only: include member values for every point")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const model = parseAtmosphericModel(options.model);
      const service = new AtmosphericBatchPointsService();
      const requestedPoints = options.point as PointCoordinate[];

      if (model === "gfs") {
        if (options.members !== undefined || options.quantiles !== undefined || options.gte !== undefined || options.includeMembers) {
          throw new Error("--members, --quantiles, --gte and --include-members are only valid with --model gefs");
        }
        const selection = pointSelection(options.vars, options.levels, options.fields);
        const result = batchPointsResultSchema.parse(await service.getPoints({
          model: "gfs_0p25",
          query: {
            points: requestedPoints,
            run: options.run,
            validTime: options.valid,
            ...selection,
          },
        }));
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
        console.log(`Source ${result.source.provider} (${result.source.access})  shared-slice cacheHit=${result.source.cacheHit}`);
        for (const [index, point] of result.points.entries()) {
          console.log(`Point ${index + 1}: ${point.requestedPoint.latitude},${point.requestedPoint.longitude} → grid ${point.gridPoint.latitude},${point.gridPoint.longitude}`);
          if (point.levels.length > 0) console.table(point.levels);
          if (point.fields) console.dir(point.fields, { depth: null });
        }
        return;
      }

      if (options.fields !== undefined) throw new Error("--fields is a deterministic GFS option and is not valid with --model gefs");
      if (options.run === "latest_complete") throw new Error("GEFS multi-point queries support --run latest or an explicit GEFS cycle, not latest_complete");
      const variables = parseGefsVariables(options.vars ?? "temperature");
      const levels = parseLevels(options.levels ?? "850");
      if (variables.length !== 1 || levels.length !== 1) {
        throw new Error("GEFS multi-point queries require exactly one --vars variable and one --levels pressure surface");
      }
      const variable = variables[0];
      const pressureLevelHpa = levels[0];
      if (variable === undefined || pressureLevelHpa === undefined) throw new Error("GEFS multi-point selection is empty");
      const result = gefsBatchPointsResultSchema.parse(await service.getPoints({
        model: "gefs_0p50",
        query: {
          points: requestedPoints,
          run: options.run,
          validTime: options.valid,
          variable,
          pressureLevelHpa,
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles ?? "0.1,0.5,0.9"),
          ...(options.gte === undefined ? {} : { thresholdGte: options.gte }),
          includeMembers: Boolean(options.includeMembers),
        },
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`${result.selection.variable}@${result.selection.pressureLevelHpa}hPa (${result.selection.unit}); ${result.selection.members.length} members; ${result.points.length} points`);
      console.log(`Source ${result.source.provider} (${result.source.access}); ${result.source.memberFiles.length} member slices; allCacheHit=${result.source.allCacheHit}`);
      console.table(result.points.map((point, index) => ({
        point: index + 1,
        requested: `${point.requestedPoint.latitude},${point.requestedPoint.longitude}`,
        grid: `${point.gridPoint.latitude},${point.gridPoint.longitude}`,
        mean: point.summary.mean,
        populationStdDev: point.summary.populationStdDev,
        min: point.summary.min,
        max: point.summary.max,
        ...(point.summary.threshold ? { thresholdFraction: point.summary.threshold.fraction } : {}),
      })));
      if (options.includeMembers) {
        for (const [index, point] of result.points.entries()) {
          console.log(`Members at point ${index + 1} (${point.requestedPoint.latitude},${point.requestedPoint.longitude})`);
          console.table(point.members ?? []);
        }
      }
    });

  program
    .command("timeseries")
    .description("Fetch a native forecast time series from GFS or GEFS; deterministic GFS remains the default model")
    .option("--model <gfs|gefs>", "Atmospheric model family", "gfs")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", "Model initialization; GEFS accepts latest or an explicit cycle", "latest")
    .requiredOption("--from <iso>", "Inclusive valid-time range start")
    .requiredOption("--to <iso>", "Inclusive valid-time range end")
    .option("--vars <list>", "Pressure-level variables; GEFS currently requires exactly one")
    .option("--levels <list>", "Pressure levels in hPa; GEFS currently requires exactly one")
    .option("--fields <list>", "GFS-only comma-separated non-isobaric field IDs")
    .option("--source <nomads|s3>", "GFS-only data access path")
    .option("--members <list>", "GEFS-only comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "GEFS-only comma-separated quantiles from 0 to 1")
    .option("--gte <number>", "GEFS-only threshold in normalized output units", Number)
    .option("--include-members", "GEFS-only: include member values at every step")
    .option("--max-steps <number>", "Maximum native forecast steps", Number)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const model = parseAtmosphericModel(options.model);
      const service = new AtmosphericTimeSeriesService();

      if (model === "gfs") {
        if (options.members !== undefined || options.quantiles !== undefined || options.gte !== undefined || options.includeMembers) {
          throw new Error("--members, --quantiles, --gte and --include-members are only valid with --model gefs");
        }
        const selection = pointSelection(options.vars, options.levels, options.fields);
        const result = timeSeriesResultSchema.parse(await service.getTimeSeries({
          model: "gfs_0p25",
          query: {
            latitude: options.lat,
            longitude: options.lon,
            run: options.run,
            startTime: options.from,
            endTime: options.to,
            ...selection,
            source: (options.source ?? "s3") as ProfileSourceId,
            maxSteps: options.maxSteps ?? 160,
          },
        }));
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        console.log(`GFS ${result.run}  ${result.requestedStartTime} → ${result.requestedEndTime}`);
        console.log(`Source ${result.source.provider} (${result.source.access})`);
        console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
        const pressureRows = result.series.flatMap((step) =>
          step.levels.map((level) => ({ valid: step.validTime, f: step.forecastHour, ...level, cacheHit: step.cacheHit })),
        );
        if (pressureRows.length > 0) console.table(pressureRows);
        if (result.series.some((step) => step.fields)) {
          console.dir(result.series.map((step) => ({
            validTime: step.validTime,
            forecastHour: step.forecastHour,
            fields: step.fields,
            cacheHit: step.cacheHit,
          })), { depth: null });
        }
        return;
      }

      if (options.fields !== undefined || options.source !== undefined) {
        throw new Error("--fields and --source are deterministic GFS options and are not valid with --model gefs");
      }
      const variables = parseGefsVariables(options.vars ?? "temperature");
      const levels = parseLevels(options.levels ?? "850");
      if (variables.length !== 1 || levels.length !== 1) {
        throw new Error("GEFS time series currently requires exactly one --vars variable and one --levels pressure surface");
      }
      const variable = variables[0];
      const pressureLevelHpa = levels[0];
      if (variable === undefined || pressureLevelHpa === undefined) throw new Error("GEFS time-series selection is empty");
      const result = gefsEnsembleTimeSeriesResultSchema.parse(await service.getTimeSeries({
        model: "gefs_0p50",
        query: {
          latitude: options.lat,
          longitude: options.lon,
          run: options.run,
          startTime: options.from,
          endTime: options.to,
          variable,
          pressureLevelHpa,
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles ?? "0.1,0.5,0.9"),
          ...(options.gte === undefined ? {} : { thresholdGte: options.gte }),
          includeMembers: Boolean(options.includeMembers),
          maxSteps: options.maxSteps ?? 129,
        },
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GEFS ${result.run}  ${result.startTime} → ${result.endTime}  ${result.series.length} steps`);
      console.log(`${result.selection.variable}@${result.selection.pressureLevelHpa}hPa (${result.selection.unit}); ${result.selection.members.length} members`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      console.table(result.series.map((step) => ({
        validTime: step.validTime,
        forecastHour: step.forecastHour,
        mean: step.summary.mean,
        populationStdDev: step.summary.populationStdDev,
        min: step.summary.min,
        max: step.summary.max,
        ...(step.summary.threshold ? { thresholdFraction: step.summary.threshold.fraction } : {}),
      })));
      if (result.includeMembers) {
        for (const step of result.series) {
          console.log(`Members at ${step.validTime}`);
          console.table(step.members ?? []);
        }
      }
    });

  program
    .command("points-timeseries")
    .description("Fetch native GFS forecast steps for multiple points using one shared S3 GRIB slice per step")
    .requiredOption("--point <lat,lon>", "Point to sample; repeat up to 20 times", collectPoint)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--from <iso>", "Inclusive valid-time range start")
    .requiredOption("--to <iso>", "Inclusive valid-time range end")
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated non-isobaric field IDs")
    .option("--max-steps <number>", "Maximum native forecast steps", Number, 80)
    .option("--max-samples <number>", "Maximum point × forecast-step samples", Number, 1600)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const selection = pointSelection(options.vars, options.levels, options.fields);
      const result = await new PointsTimeSeriesService().getPointsTimeSeries({
        points: options.point as PointCoordinate[],
        run: options.run,
        startTime: options.from,
        endTime: options.to,
        ...selection,
        maxSteps: options.maxSteps,
        maxSamples: options.maxSamples,
      });
      pointsTimeSeriesResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS ${result.run}  ${result.requestedStartTime} → ${result.requestedEndTime}`);
      console.log(`Source ${result.source.provider} (${result.source.access}); one shared selected-message slice per forecast step`);
      for (const step of result.series) {
        console.log(`Valid ${step.validTime}  f${String(step.forecastHour).padStart(3, "0")}  shared-slice cacheHit=${step.cacheHit}`);
        for (const [index, point] of step.points.entries()) {
          console.log(`Point ${index + 1}: ${point.requestedPoint.latitude},${point.requestedPoint.longitude} → grid ${point.gridPoint.latitude},${point.gridPoint.longitude}`);
          if (point.levels.length > 0) console.table(point.levels);
          if (point.fields) console.dir(point.fields, { depth: null });
        }
      }
    });

  program
    .command("compare-runs")
    .description("Compare one point/valid time across consecutive GFS or GEFS six-hour model cycles")
    .option("--model <gfs|gefs>", "Atmospheric model family", "gfs")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--anchor <iso|latest|latest_complete>", "Newest run in the comparison; GEFS accepts latest or an explicit cycle", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time compared across cycles")
    .option("--vars <list>", "Pressure-level variables; GEFS requires exactly one")
    .option("--levels <list>", "Pressure levels in hPa; GEFS requires exactly one")
    .option("--fields <list>", "GFS-only comma-separated non-isobaric field IDs")
    .option("--members <list>", "GEFS-only comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "GEFS-only comma-separated quantiles from 0 to 1")
    .option("--gte <number>", "GEFS-only threshold in normalized output units", Number)
    .option("--cycles <number>", "Number of consecutive six-hour model cycles to compare (2-6)", Number, 3)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const model = parseAtmosphericModel(options.model);
      const service = new AtmosphericRunComparisonService();

      if (model === "gfs") {
        if (options.members !== undefined || options.quantiles !== undefined || options.gte !== undefined) {
          throw new Error("--members, --quantiles and --gte are only valid with --model gefs");
        }
        const selection = pointSelection(options.vars, options.levels, options.fields);
        const result = runComparisonResultSchema.parse(await service.compareRuns({
          model: "gfs_0p25",
          query: {
            latitude: options.lat,
            longitude: options.lon,
            anchorRun: options.anchor,
            validTime: options.valid,
            ...selection,
            cycles: options.cycles,
          },
        }));
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        console.log(`GFS run comparison  valid ${result.validTime}`);
        console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
        console.log(`Anchor ${result.anchorRun}; source ${result.source.provider} (${result.source.access})`);
        console.table(result.runs.map((run) => ({ run: run.run, forecastHour: run.forecastHour, cacheHit: run.cacheHit })));
        for (const comparison of result.comparisons) {
          console.log(`${comparison.fromRun} → ${comparison.toRun}  (f${comparison.fromForecastHour} → f${comparison.toForecastHour}); deltas = newer - older`);
          const pressureRows = comparison.pressureLevels.flatMap((level) => level.changes.map((change) => ({
            pressureHpa: level.pressureHpa,
            field: change.field,
            from: change.from,
            to: change.to,
            delta: change.delta,
            deltaKind: change.deltaKind,
          })));
          if (pressureRows.length > 0) console.table(pressureRows);
          if (comparison.fields.length > 0) console.dir(comparison.fields, { depth: null });
        }
        return;
      }

      if (options.fields !== undefined) throw new Error("--fields is a deterministic GFS option and is not valid with --model gefs");
      if (options.anchor === "latest_complete") throw new Error("GEFS run comparison supports --anchor latest or an explicit GEFS cycle, not latest_complete");
      const variables = parseGefsVariables(options.vars ?? "temperature");
      const levels = parseLevels(options.levels ?? "850");
      if (variables.length !== 1 || levels.length !== 1) {
        throw new Error("GEFS run comparison requires exactly one --vars variable and one --levels pressure surface");
      }
      const variable = variables[0];
      const pressureLevelHpa = levels[0];
      if (variable === undefined || pressureLevelHpa === undefined) throw new Error("GEFS run-comparison selection is empty");
      const result = gefsRunComparisonResultSchema.parse(await service.compareRuns({
        model: "gefs_0p50",
        query: {
          latitude: options.lat,
          longitude: options.lon,
          anchorRun: options.anchor,
          validTime: options.valid,
          variable,
          pressureLevelHpa,
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles ?? "0.1,0.5,0.9"),
          ...(options.gte === undefined ? {} : { thresholdGte: options.gte }),
          cycles: options.cycles,
        },
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GEFS run comparison  valid ${result.validTime}`);
      console.log(`${result.selection.variable}@${result.selection.pressureLevelHpa}hPa (${result.selection.unit}); ${result.selection.members.length} members`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      console.log(`Anchor ${result.anchorRun}; source ${result.source.provider} (${result.source.access})`);
      console.table(result.runs.map((run) => ({
        run: run.run,
        forecastHour: run.forecastHour,
        mean: run.summary.mean,
        populationStdDev: run.summary.populationStdDev,
        min: run.summary.min,
        max: run.summary.max,
        ...(run.summary.threshold ? { thresholdFraction: run.summary.threshold.fraction } : {}),
        allCacheHit: run.allCacheHit,
      })));
      for (const comparison of result.comparisons) {
        console.log(`${comparison.fromRun} → ${comparison.toRun}  (f${comparison.fromForecastHour} → f${comparison.toForecastHour}); distribution deltas = newer - older`);
        console.table([
          { metric: "mean", ...comparison.mean },
          { metric: "populationStdDev", ...comparison.populationStdDev },
          { metric: "min", ...comparison.min },
          { metric: "max", ...comparison.max },
          ...comparison.quantiles.map((quantile) => ({ metric: `q${quantile.quantile}`, from: quantile.from, to: quantile.to, delta: quantile.delta })),
          ...(comparison.thresholdFraction ? [{
            metric: `fraction>=${comparison.thresholdFraction.threshold}`,
            from: comparison.thresholdFraction.from,
            to: comparison.thresholdFraction.to,
            delta: comparison.thresholdFraction.delta,
          }] : []),
        ]);
      }
    });
}
