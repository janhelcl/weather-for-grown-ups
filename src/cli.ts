#!/usr/bin/env node
import { Command } from "commander";
import { getGfsPressureCatalog } from "./catalog/catalog.js";
import { AreaSummaryService } from "./core/area-summary.js";
import { LatestRunResolver } from "./core/latest-run.js";
import { ProfileService } from "./core/profile.js";
import { TimeSeriesService } from "./core/time-series.js";
import type { NonIsobaricFieldId, ProfileSourceId, RawVariableId, VariableId } from "./schema/query.js";

const DEFAULT_VARIABLES = "temperature,relative_humidity,wind";
const DEFAULT_LEVELS = "1000,925,850,700,500";

const program = new Command();
program.name("wfg").description("Weather for Grown Ups — agent-native NOAA GFS access").version("0.1.0");

program
  .command("catalog")
  .description("Show supported GFS pressure-level and non-isobaric fields")
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
  .description("Resolve the latest complete GFS 0.25° run")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const run = await new LatestRunResolver().resolveLatestRun();
    if (options.json) {
      console.log(JSON.stringify({ model: "gfs_0p25", run: run.toISOString(), completeness: "f384" }, null, 2));
      return;
    }
    console.log(run.toISOString());
  });

program
  .command("profile")
  .description("Fetch GFS pressure levels and/or non-isobaric fields for a point")
  .requiredOption("--lat <number>", "Latitude", Number)
  .requiredOption("--lon <number>", "Longitude", Number)
  .option("--run <iso|latest>", "GFS run initialization, or latest complete run", "latest")
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
    if (options.json) return console.log(JSON.stringify(result, null, 2));
    console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
    console.log(`Source ${result.source.provider} (${result.source.access})`);
    console.log(`Requested ${result.requestedPoint.latitude},${result.requestedPoint.longitude} → grid ${result.gridPoint.latitude},${result.gridPoint.longitude}`);
    if (result.levels.length > 0) console.table(result.levels);
    if (result.fields) console.dir(result.fields, { depth: null });
  });

program
  .command("timeseries")
  .description("Fetch native GFS forecast steps for pressure levels and/or non-isobaric fields")
  .requiredOption("--lat <number>", "Latitude", Number)
  .requiredOption("--lon <number>", "Longitude", Number)
  .option("--run <iso|latest>", "GFS run initialization, or latest complete run", "latest")
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
  .option("--run <iso|latest>", "GFS run initialization, or latest complete run", "latest")
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

function parseVariables(value: unknown): VariableId[] {
  return String(value).split(",").map((variable) => variable.trim()).filter(Boolean) as VariableId[];
}

function parseLevels(value: unknown): number[] {
  return String(value).split(",").map((level) => level.trim()).filter(Boolean).map(Number);
}

function parseFields(value: unknown): NonIsobaricFieldId[] {
  if (value === undefined) return [];
  return String(value).split(",").map((field) => field.trim()).filter(Boolean) as NonIsobaricFieldId[];
}
