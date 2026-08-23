#!/usr/bin/env node
import { Command } from "commander";
import { getGfsPressureCatalog } from "./catalog/catalog.js";
import { AreaSummaryService } from "./core/area-summary.js";
import { BatchPointsService } from "./core/batch-points.js";
import { LayerDiagnosticsService } from "./core/layer-diagnostics.js";
import { LatestRunResolver } from "./core/latest-run.js";
import { ProfileService } from "./core/profile.js";
import { TimeSeriesService } from "./core/time-series.js";
import type {
  LayerDiagnosticId,
  NonIsobaricFieldId,
  PointCoordinate,
  ProfileSourceId,
  RawVariableId,
  VariableId,
} from "./schema/query.js";
import {
  areaSummaryResultSchema,
  batchPointsResultSchema,
  layerDiagnosticsResultSchema,
  latestGfsRunResultSchema,
  profileResultSchema,
  timeSeriesResultSchema,
} from "./schema/result.js";

const DEFAULT_VARIABLES = "temperature,relative_humidity,wind";
const DEFAULT_LEVELS = "1000,925,850,700,500";
const DEFAULT_LAYER_DIAGNOSTICS = "temperature_lapse_rate,wind_shear,potential_temperature_gradient";
const RUN_HELP = "GFS run initialization; latest = newest run satisfying this query, latest_complete = newest run published through f384";

const program = new Command();
program.name("wfg").description("Weather for Grown Ups — agent-native NOAA GFS access").version("0.1.0");

program
  .command("catalog")
  .description("Show supported GFS pressure-level variables, layer diagnostics, and non-isobaric fields")
  .option("--json", "Output JSON")
  .action((options) => {
    const catalog = getGfsPressureCatalog();
    if (options.json) {
      console.log(JSON.stringify(catalog, null, 2));
      return;
    }
    console.log("Pressure-level variables");
    console.table(catalog.variables.map((variable) => ({
      id: variable.id,
      kind: variable.kind,
      gfs: "gfsCode" in variable ? variable.gfsCode : "derived",
      output: variable.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
    })));
    console.log(`Pressure levels (hPa): ${catalog.pressureLevelsHpa.join(", ")}`);
    console.log("Pressure-layer diagnostics");
    console.table(catalog.layerDiagnostics.map((diagnostic) => ({
      id: diagnostic.id,
      dependencies: diagnostic.dependencies.join(", "),
      output: diagnostic.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
    })));
    console.log("Non-isobaric fields");
    console.table(catalog.fields.map((field) => ({
      id: field.id,
      kind: field.kind,
      level: formatFieldLevel(field.level),
      temporal: field.temporalSemantics,
      gfs: "gfsCode" in field ? field.gfsCode : "derived",
      output: field.outputs.map((output) => `${output.field} [${output.unit}]`).join(", "),
    })));
  });

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
  .command("layer")
  .description("Derive deterministic diagnostics across two GFS pressure surfaces")
  .requiredOption("--lat <number>", "Latitude", Number)
  .requiredOption("--lon <number>", "Longitude", Number)
  .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
  .requiredOption("--valid <iso>", "Forecast valid time")
  .requiredOption("--lower <hpa>", "Lower-altitude pressure surface in hPa", Number)
  .requiredOption("--upper <hpa>", "Upper-altitude pressure surface in hPa", Number)
  .option("--diagnostics <list>", "Comma-separated layer diagnostic IDs", DEFAULT_LAYER_DIAGNOSTICS)
  .option("--source <nomads|s3>", "Data access path", "nomads")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const result = await new LayerDiagnosticsService().getLayerDiagnostics({
      latitude: options.lat,
      longitude: options.lon,
      run: options.run,
      validTime: options.valid,
      lowerPressureHpa: options.lower,
      upperPressureHpa: options.upper,
      diagnostics: parseLayerDiagnostics(options.diagnostics),
      source: options.source as ProfileSourceId,
    });
    layerDiagnosticsResultSchema.parse(result);
    if (options.json) return console.log(JSON.stringify(result, null, 2));
    console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
    console.log(`Source ${result.source.provider} (${result.source.access})`);
    console.log(`${result.layer.lowerPressureHpa} → ${result.layer.upperPressureHpa} hPa; ${result.layer.lowerGeopotentialHeightGpm.toFixed(0)} → ${result.layer.upperGeopotentialHeightGpm.toFixed(0)} gpm; depth ${result.layer.depthGpm.toFixed(0)} gpm`);
    console.table(result.diagnostics.map((diagnostic) => ({ id: diagnostic.id, ...diagnostic.values })));
    console.log("Raw endpoint values used by the derivations");
    console.table(result.levels);
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
  .command("area")
  .description("Summarize one raw GFS pressure field over a bounded area")
  .requiredOption("--west <number>", "Western longitude", Number)
  .requiredOption("--east <number>", "Eastern longitude", Number)
  .requiredOption("--south <number>", "Southern latitude", Number)
  .requiredOption("--north <number>", "Northern latitude", Number)
  .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
  .requiredOption("--valid <iso>", "Forecast valid time")
  .requiredOption("--var <id>", "One raw pressure-level variable")
  .requiredOption("--level <hpa>", "Pressure level in hPa", Number)
  .option("--max-grid-points <number>", "Maximum estimated GFS grid points", Number, 50000)
  .option("--json", "Output JSON")
  .action(async (options) => {
    const result = await new AreaSummaryService().summarize({
      westLongitude: options.west,
      eastLongitude: options.east,
      southLatitude: options.south,
      northLatitude: options.north,
      run: options.run,
      validTime: options.valid,
      variable: options.var as RawVariableId,
      pressureLevelHpa: options.level,
      maxGridPoints: options.maxGridPoints,
    });
    areaSummaryResultSchema.parse(result);
    if (options.json) return console.log(JSON.stringify(result, null, 2));
    console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
    console.log(`${result.variable.id} ${result.variable.pressureHpa} hPa [${result.variable.unit}]`);
    console.table([result.statistics]);
  });

await program.parseAsync();

function formatFieldLevel(level: ReturnType<typeof getGfsPressureCatalog>["fields"][number]["level"]): string {
  switch (level.type) {
    case "surface": return "surface";
    case "height_above_ground_m": return `${level.heightM} m AGL`;
    case "named_layer": return level.id.replaceAll("_", " ");
    case "named_level": return level.id.replaceAll("_", " ");
  }
}

function pointSelection(vars: unknown, levels: unknown, fields: unknown): {
  variables?: VariableId[];
  pressureLevelsHpa?: number[];
  fields?: NonIsobaricFieldId[];
} {
  const parsedFields = parseFields(fields);
  const hasExplicitPressureSelection = vars !== undefined || levels !== undefined;
  const includeDefaultPressureSelection = !hasExplicitPressureSelection && parsedFields.length === 0;

  const variables = vars !== undefined
    ? parseVariables(vars)
    : hasExplicitPressureSelection || includeDefaultPressureSelection
      ? parseVariables(DEFAULT_VARIABLES)
      : undefined;
  const pressureLevelsHpa = levels !== undefined
    ? parseLevels(levels)
    : hasExplicitPressureSelection || includeDefaultPressureSelection
      ? parseLevels(DEFAULT_LEVELS)
      : undefined;

  return {
    ...(variables === undefined ? {} : { variables }),
    ...(pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa }),
    ...(parsedFields.length === 0 ? {} : { fields: parsedFields }),
  };
}

function collectPoint(value: string, previous: PointCoordinate[] | undefined): PointCoordinate[] {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2) throw new Error(`Expected --point lat,lon, received: ${value}`);
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Expected numeric --point lat,lon, received: ${value}`);
  }
  return [...(previous ?? []), { latitude, longitude }];
}

function parseVariables(value: unknown): VariableId[] {
  return String(value).split(",").map((variable) => variable.trim()).filter(Boolean) as VariableId[];
}

function parseLayerDiagnostics(value: unknown): LayerDiagnosticId[] {
  return String(value).split(",").map((diagnostic) => diagnostic.trim()).filter(Boolean) as LayerDiagnosticId[];
}

function parseLevels(value: unknown): number[] {
  return String(value).split(",").map((level) => level.trim()).filter(Boolean).map(Number);
}

function parseFields(value: unknown): NonIsobaricFieldId[] {
  if (value === undefined) return [];
  return String(value).split(",").map((field) => field.trim()).filter(Boolean) as NonIsobaricFieldId[];
}
