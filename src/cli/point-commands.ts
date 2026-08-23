import type { Command } from "commander";
import { BatchPointsService } from "../core/batch-points.js";
import { LatestRunResolver } from "../core/latest-run.js";
import { PointsTimeSeriesService } from "../core/points-time-series.js";
import { ProfileService } from "../core/profile.js";
import { RunComparisonService } from "../core/run-comparison.js";
import { TimeSeriesService } from "../core/time-series.js";
import type { PointCoordinate, ProfileSourceId } from "../schema/query.js";
import {
  batchPointsResultSchema,
  latestGfsRunResultSchema,
  pointsTimeSeriesResultSchema,
  profileResultSchema,
  timeSeriesResultSchema,
} from "../schema/result.js";
import { runComparisonResultSchema } from "../schema/run-comparison-result.js";
import { RUN_HELP, collectPoint, pointSelection } from "./shared.js";

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
    .description("Fetch GFS pressure levels and/or non-isobaric fields for a point")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated non-isobaric field IDs")
    .option("--source <nomads|s3>", "Data access path", "nomads")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const selection = pointSelection(options.vars, options.levels, options.fields);
      const result = await new ProfileService().getProfile({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        validTime: options.valid,
        ...selection,
        source: options.source as ProfileSourceId,
      });
      profileResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`Source ${result.source.provider} (${result.source.access})`);
      console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
      if (result.levels.length > 0) console.table(result.levels);
      if (result.fields) console.dir(result.fields, { depth: null });
    });

  program
    .command("points")
    .description("Fetch one GFS field selection for multiple points using a shared S3 GRIB slice")
    .requiredOption("--point <lat,lon>", "Point to sample; repeat up to 50 times", collectPoint)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated non-isobaric field IDs")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const selection = pointSelection(options.vars, options.levels, options.fields);
      const result = await new BatchPointsService().getPoints({
        points: options.point as PointCoordinate[],
        run: options.run,
        validTime: options.valid,
        ...selection,
      });
      batchPointsResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`Source ${result.source.provider} (${result.source.access})  shared-slice cacheHit=${result.source.cacheHit}`);
      for (const [index, point] of result.points.entries()) {
        console.log(`Point ${index + 1}: ${point.requestedPoint.latitude},${point.requestedPoint.longitude} → grid ${point.gridPoint.latitude},${point.gridPoint.longitude}`);
        if (point.levels.length > 0) console.table(point.levels);
        if (point.fields) console.dir(point.fields, { depth: null });
      }
    });

  program
    .command("timeseries")
    .description("Fetch native GFS forecast steps for pressure levels and/or non-isobaric fields")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--from <iso>", "Inclusive valid-time range start")
    .requiredOption("--to <iso>", "Inclusive valid-time range end")
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated non-isobaric field IDs")
    .option("--source <nomads|s3>", "Data access path", "s3")
    .option("--max-steps <number>", "Maximum native forecast steps", Number, 160)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const selection = pointSelection(options.vars, options.levels, options.fields);
      const result = await new TimeSeriesService().getTimeSeries({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        startTime: options.from,
        endTime: options.to,
        ...selection,
        source: options.source as ProfileSourceId,
        maxSteps: options.maxSteps,
      });
      timeSeriesResultSchema.parse(result);
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
    .description("Compare one point/valid time across consecutive six-hour GFS model cycles")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--anchor <iso|latest|latest_complete>", "Newest run in the comparison", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time compared across cycles")
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated non-isobaric field IDs")
    .option("--cycles <number>", "Number of consecutive six-hour model cycles to compare (2-6)", Number, 3)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const selection = pointSelection(options.vars, options.levels, options.fields);
      const result = await new RunComparisonService().compareRuns({
        latitude: options.lat,
        longitude: options.lon,
        anchorRun: options.anchor,
        validTime: options.valid,
        ...selection,
        cycles: options.cycles,
      });
      runComparisonResultSchema.parse(result);
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
    });
}
