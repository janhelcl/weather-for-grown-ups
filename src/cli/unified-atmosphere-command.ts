import type { Command } from "commander";
import {
  UnifiedAnalogService,
  UnifiedAtmosphereAlignmentService,
  UnifiedAtmosphereDiagnosticService,
  UnifiedAtmosphereQueryService,
  UnifiedForecastVerificationService,
} from "../core/unified-atmosphere-api.js";
import {
  atmosphericDiagnosticSelectionSchema,
  PUBLIC_ATMOSPHERIC_DATASET_IDS,
  publicAtmosphericDatasetSchema,
  publicDatasetMetadata,
  type DiagnoseAtmosphereInput,
  type PublicAtmosphericDataset,
  type QueryAtmosphereInput,
} from "../schema/unified-api.js";
import type { PublicQueryAtmosphereInput } from "../schema/unified-query-input.js";
import {
  MAX_ALIGNMENT_SOURCES,
  alignAtmosphereSchema,
  type AlignAtmosphereInput,
} from "../schema/unified-alignment.js";
import type { VerifyAtmosphericForecastInput } from "../schema/unified-specialized.js";
import type { PointCoordinate } from "../schema/query.js";
import type { AtmosphericStepProgress } from "../core/progress.js";
import { InvalidRequestError } from "../failure.js";
import {
  DEFAULT_LEVELS,
  collectPoint,
  numberOption,
  parseCoordinate,
  parseGefsMembers,
  parseIfsEnsMembers,
  parseNumberList,
  parseStringList,
} from "./shared.js";
import { printAtmosphericResult } from "./print-result.js";

const DEFAULT_UNIFIED_VARIABLES =
  "temperature,relative_humidity,u_wind,v_wind,geopotential_height";
const DEFAULT_IGRA_VERIFICATION_VARIABLES =
  "temperature,relative_humidity,wind,geopotential_height";

export function registerUnifiedAtmosphereCommands(program: Command): void {
  registerQueryCommand(program);
  registerDiagnoseCommand(program);
  registerAlignCommand(program);
  registerVerifyCommand(program);
  registerAnalogsCommand(program);
}

function registerQueryCommand(program: Command): void {
  program
    .command("query")
    .description("Query atmospheric state through dataset × geometry × time × selection")
    .option("--dataset <id>", `Atmospheric dataset (${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")})`, "gfs")
    .option("--lat <number>", "Point latitude", numberOption("--lat"))
    .option("--lon <number>", "Point longitude", numberOption("--lon"))
    .option("--point <lat,lon>", "Multi-point coordinate; repeat as needed", collectPoint)
    .option("--start <lat,lon>", "Transect start")
    .option("--end <lat,lon>", "Transect end")
    .option("--samples <number>", "Transect sample count", numberOption("--samples"))
    .option("--west <number>", "Area west longitude", numberOption("--west"))
    .option("--east <number>", "Area east longitude", numberOption("--east"))
    .option("--south <number>", "Area south latitude", numberOption("--south"))
    .option("--north <number>", "Area north latitude", numberOption("--north"))
    .option("--at <iso>", "One atmospheric valid time")
    .option("--from <iso>", "Inclusive valid-time range start")
    .option("--to <iso>", "Inclusive valid-time range end")
    .option("--cycles <list>", "gfs-analysis range only: UTC cycles such as 0,6,12,18")
    .option("--max-steps <number>", "Maximum time steps", numberOption("--max-steps"))
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated non-isobaric fields")
    .option("--run <iso|latest|latest_complete>", "Forecast initialization")
    .option("--forecast-kind <operational|reforecast>", "Forecast population; reforecast currently selects GEFSv12 retrospective forecasts")
    .option("--grid <0p25|0p50>", "GFS horizontal grid")
    .option("--source <nomads|s3|archive>", "GFS source override; omit for automatic AWS/NOMADS/archive routing")
    .option("--members <list>", "Dataset-native ensemble member IDs; use catalog/search_catalog for the supported population")
    .option("--quantiles <list>", "Ensemble quantiles from 0 to 1")
    .option("--include-members", "Include raw ensemble member payloads where supported")
    .option("--percentiles <list>", "Area spatial percentiles, e.g. 10,50,90")
    .option("--gte <number>", "Area fraction at or above this threshold", numberOption("--gte"))
    .option("--lte <number>", "Area fraction at or below this threshold", numberOption("--lte"))
    .option("--extrema", "Area representative min/max locations")
    .option("--max-samples <number>", "Multi-point time-series sample guardrail", numberOption("--max-samples"))
    .option("--max-point-steps <number>", "Point × time-step guardrail", numberOption("--max-point-steps"))
    .option("--max-grid-points <number>", "Area grid-point guardrail", numberOption("--max-grid-points"))
    .option("--max-member-grid-points <number>", "Ensemble area member × grid guardrail", numberOption("--max-member-grid-points"))
    .option("--max-member-samples <number>", "Ensemble raw member payload guardrail", numberOption("--max-member-samples"))
    .option(
      "--diagnostic <json>",
      "Canonical layer/profile/parcel diagnostic selector JSON; repeat to bundle diagnostics with point state",
      collectBundledDiagnostic,
    )
    .option("--json", "Output JSON")
    .action(async (options) => {
      const request = buildUnifiedQuery(options);
      const result = await new UnifiedAtmosphereQueryService({
        progress: reportCliProgress,
      }).query(request);
      printResult(result, Boolean(options.json));
    });
}

function registerDiagnoseCommand(program: Command): void {
  program
    .command("diagnose")
    .description("Derive layer, profile, or parcel meteorology from any atmospheric dataset")
    .option("--dataset <id>", `Atmospheric dataset (${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")})`, "gfs")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .requiredOption("--kind <layer|profile|parcel>", "Diagnostic family")
    .option("--at <iso>", "One atmospheric valid time")
    .option("--from <iso>", "Inclusive valid-time range start")
    .option("--to <iso>", "Inclusive valid-time range end")
    .option("--cycles <list>", "gfs-analysis range only: UTC cycles such as 0,6,12,18")
    .option("--max-steps <number>", "Maximum time steps", numberOption("--max-steps"))
    .option("--lower <hpa>", "Layer lower pressure surface", numberOption("--lower"))
    .option("--upper <hpa>", "Layer upper pressure surface", numberOption("--upper"))
    .option("--levels <list>", "Profile/parcel pressure levels in hPa", DEFAULT_LEVELS)
    .option("--diagnostics <list>", "Layer/profile diagnostic IDs")
    .option("--parcel <surface_2m|mixed_layer_100hpa|most_unstable_300hpa>", "Parcel definition")
    .option("--run <iso|latest|latest_complete>", "Forecast initialization")
    .option("--forecast-kind <operational|reforecast>", "Forecast population; reforecast currently selects GEFSv12 retrospective forecasts")
    .option("--grid <0p25|0p50>", "GFS horizontal grid")
    .option("--source <nomads|s3|archive>", "GFS source override; omit for automatic AWS/NOMADS/archive routing")
    .option("--members <list>", "Dataset-native ensemble member IDs; use catalog/search_catalog for the supported population")
    .option("--quantiles <list>", "Ensemble quantiles from 0 to 1")
    .option("--include-members", "Ensemble instant diagnostics only: include member payloads")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const request = buildUnifiedDiagnostic(options);
      const result = await new UnifiedAtmosphereDiagnosticService().diagnose(request);
      printResult(result, Boolean(options.json));
    });
}

function registerAlignCommand(program: Command): void {
  program
    .command("align")
    .description("Align one point × time × selection question across several dataset/run/member sources into one canonical evidence table")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .option("--at <iso>", "One atmospheric valid time")
    .option("--from <iso>", "Inclusive valid-time range start")
    .option("--to <iso>", "Inclusive valid-time range end")
    .option("--max-steps <number>", "Maximum time steps per source", numberOption("--max-steps"))
    .option(
      "--source <spec>",
      `Repeatable (2-${MAX_ALIGNMENT_SOURCES}). dataset[@run][;members=c00,p01][;quantiles=0.1,0.9][;label=name][;grid=0p25|0p50][;kind=operational|reforecast][;source=nomads|s3|archive]. Example: --source gfs --source gfs@2026-09-09T18:00:00Z --source ifs-ens`,
      collectAlignmentSource,
    )
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated non-isobaric fields")
    .option("--quantiles <list>", "Quantiles applied to every ensemble source without its own quantiles")
    .option("--initialization <independent|shared>", "shared fails unless every forecast source resolves to the same run", "independent")
    .option("--valid-times <intersection|union>", "Time-range axis across sources", "intersection")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await new UnifiedAtmosphereAlignmentService().align(buildUnifiedAlignment(options));
      printResult(result, Boolean(options.json));
    });
}

export function collectAlignmentSource(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

/**
 * `--source` spec grammar: `dataset[@run][;key=value...]` with keys run, members,
 * quantiles, label, grid, kind, source. Everything after the dataset is optional.
 */
export function parseAlignmentSource(spec: string): NonNullable<AlignAtmosphereInput["sources"]>[number] {
  const segments = String(spec).split(";").map((segment) => segment.trim()).filter(Boolean);
  const head = segments.shift();
  if (head === undefined) {
    throw new InvalidRequestError("Expected --source dataset[@run][;key=value], received an empty spec", {
      details: { option: "--source", received: spec },
    });
  }
  const atIndex = head.indexOf("@");
  const datasetText = (atIndex === -1 ? head : head.slice(0, atIndex)).trim().toLowerCase();
  const parsedDataset = publicAtmosphericDatasetSchema.safeParse(datasetText);
  if (!parsedDataset.success) {
    throw new InvalidRequestError(
      `Expected --source dataset to be one of ${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")}, received: ${datasetText}`,
      { details: { option: "--source", received: spec } },
    );
  }
  const dataset = parsedDataset.data;
  const modifiers: Record<string, string> = {};
  if (atIndex !== -1) modifiers.run = head.slice(atIndex + 1).trim();
  for (const segment of segments) {
    const equals = segment.indexOf("=");
    if (equals === -1) {
      throw new InvalidRequestError(`Expected --source modifier key=value, received: ${segment}`, {
        details: { option: "--source", received: spec },
      });
    }
    const key = segment.slice(0, equals).trim();
    const modifierValue = segment.slice(equals + 1).trim();
    if (!ALIGNMENT_SOURCE_KEYS.has(key)) {
      throw new InvalidRequestError(
        `Unknown --source modifier "${key}"; supported: ${[...ALIGNMENT_SOURCE_KEYS].join(", ")}`,
        { details: { option: "--source", received: spec } },
      );
    }
    modifiers[key] = modifierValue;
  }

  const forecast = {
    ...(modifiers.kind === undefined ? {} : { kind: modifiers.kind as "operational" | "reforecast" }),
    ...(modifiers.run === undefined ? {} : { run: modifiers.run }),
    ...(modifiers.grid === undefined ? {} : { grid: modifiers.grid as "0p25" | "0p50" }),
  };
  const ensemble = {
    ...(modifiers.members === undefined ? {} : { members: parseEnsembleMembers(dataset, modifiers.members) }),
    ...(modifiers.quantiles === undefined
      ? {}
      : { quantiles: parseNumberList(modifiers.quantiles, "--source quantiles") }),
  };
  return {
    dataset,
    ...(modifiers.label === undefined ? {} : { label: modifiers.label }),
    ...(Object.keys(forecast).length === 0 ? {} : { forecast }),
    ...(Object.keys(ensemble).length === 0 ? {} : { ensemble }),
    ...(modifiers.source === undefined ? {} : { source: modifiers.source as "nomads" | "s3" | "archive" }),
  };
}

const ALIGNMENT_SOURCE_KEYS = new Set(["run", "members", "quantiles", "label", "grid", "kind", "source"]);

export function buildUnifiedAlignment(options: Record<string, any>): AlignAtmosphereInput {
  const specs: string[] = options.source ?? [];
  if (specs.length < 2) {
    throw new InvalidRequestError(
      "Alignment needs at least two --source specs, e.g. --source gfs --source ifs",
      { details: { option: "--source", received: specs } },
    );
  }
  const sharedQuantiles = options.quantiles === undefined
    ? undefined
    : parseNumberList(options.quantiles, "--quantiles");
  const sources = specs.map(parseAlignmentSource).map((source) => {
    if (
      sharedQuantiles === undefined
      || source.ensemble?.quantiles !== undefined
      || publicDatasetMetadata(source.dataset).kind !== "ensemble"
    ) return source;
    return { ...source, ensemble: { ...(source.ensemble ?? {}), quantiles: sharedQuantiles } };
  });
  const alignment = {
    ...(options.initialization === undefined ? {} : { initialization: options.initialization }),
    ...(options.validTimes === undefined ? {} : { validTimes: options.validTimes }),
  };
  const request = {
    sources,
    geometry: { type: "point" as const, latitude: options.lat, longitude: options.lon },
    time: parseTime(options),
    selection: parseSelection({ vars: options.vars, levels: options.levels, fields: options.fields }),
    ...(Object.keys(alignment).length === 0 ? {} : { alignment }),
  };
  return alignAtmosphereSchema.parse(request) as AlignAtmosphereInput;
}

function registerVerifyCommand(program: Command): void {
  program
    .command("verify")
    .description("Verify archived GFS forecasts against GFS analysis or IGRA radiosondes")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .option("--at <iso>", "One historical valid time")
    .option("--from <iso>", "Skill-summary range start")
    .option("--to <iso>", "Skill-summary range end")
    .requiredOption("--lead-hours <number|list>", "Forecast lead(s) in hours; multiples of 6")
    .option("--reference <gfs-analysis|igra>", "Verification reference", "gfs-analysis")
    .option("--hours <list>", "Skill-summary nominal UTC cycles", "0,12")
    .option("--max-valid-times <number>", "Skill-summary sampling cap (max 8)", numberOption("--max-valid-times"), 8)
    .option("--grid <0p25|0p50>", "GFS forecast grid; IGRA reference only")
    .option("--station <id>", "Explicit 11-character IGRA station ID")
    .option("--max-station-distance-km <number>", "Maximum IGRA station distance", numberOption("--max-station-distance-km"))
    .option("--vars <list>", "Pressure-level variables")
    .option("--levels <list>", "Pressure levels in hPa", DEFAULT_LEVELS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const hasInstant = options.at !== undefined;
      const hasRange = options.from !== undefined || options.to !== undefined;
      if (hasInstant === hasRange) {
        throw new InvalidRequestError("Choose exactly one verification time form: --at, or --from plus --to");
      }
      if (hasRange && (options.from === undefined || options.to === undefined)) {
        throw new InvalidRequestError("Skill-summary verification requires both --from and --to");
      }

      const referenceDataset = String(options.reference);
      const defaultVariables = referenceDataset === "igra"
        ? DEFAULT_IGRA_VERIFICATION_VARIABLES
        : DEFAULT_UNIFIED_VARIABLES;
      const leads = parseNumberList(options.leadHours, "--lead-hours");
      if (hasInstant && leads.length !== 1) {
        throw new InvalidRequestError("Atomic verification requires exactly one --lead-hours value");
      }

      const common = {
        forecastDataset: "gfs" as const,
        geometry: { type: "point" as const, latitude: options.lat, longitude: options.lon },
        variables: parseStringList(options.vars ?? defaultVariables),
        pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
        ...(options.grid === undefined ? {} : { gfsGrid: options.grid }),
        ...(options.station === undefined ? {} : { stationId: options.station }),
        ...(options.maxStationDistanceKm === undefined
          ? {}
          : { maxStationDistanceKm: options.maxStationDistanceKm }),
      };

      const request: VerifyAtmosphericForecastInput = hasInstant
        ? {
            ...common,
            referenceDataset: referenceDataset as "gfs-analysis" | "igra",
            time: { at: options.at },
            leadHours: leads[0]!,
          }
        : {
            ...common,
            referenceDataset: referenceDataset as "gfs-analysis" | "igra",
            time: {
              from: options.from,
              to: options.to,
              hoursUtc: parseNumberList(options.hours, "--hours") as Array<0 | 6 | 12 | 18>,
              maxValidTimes: options.maxValidTimes,
            },
            leadHours: leads,
          };

      const result = await new UnifiedForecastVerificationService().verify(request);
      printResult(result, Boolean(options.json));
    });
}

function registerAnalogsCommand(program: Command): void {
  program
    .command("analogs")
    .description("Find historical atmospheric analogs in the local materialized index")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .requiredOption("--at <iso>", "Target historical analysis time")
    .option("--vars <list>", "Pressure-level variables", DEFAULT_UNIFIED_VARIABLES)
    .option("--levels <list>", "Pressure levels in hPa", DEFAULT_LEVELS)
    .option("--count <number>", "Number of analogs", numberOption("--count"), 5)
    .option("--exclude-within-hours <number>", "Exclude candidates near target time", numberOption("--exclude-within-hours"), 24)
    .option("--no-fetch-target", "Do not fetch and materialize the target when missing")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await new UnifiedAnalogService().find({
        dataset: "gfs-analysis",
        geometry: { type: "point", latitude: options.lat, longitude: options.lon },
        time: { at: options.at },
        variables: parseStringList(options.vars),
        pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
        count: options.count,
        excludeWithinHours: options.excludeWithinHours,
        fetchTargetIfMissing: options.fetchTarget,
      });
      printResult(result, Boolean(options.json));
    });
}

export function collectBundledDiagnostic(
  value: string,
  previous: DiagnoseAtmosphereInput["diagnostic"][] | undefined,
): DiagnoseAtmosphereInput["diagnostic"][] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new InvalidRequestError("Expected --diagnostic to be valid JSON", {
      details: { option: "--diagnostic", received: value },
    });
  }

  const parsed = atmosphericDiagnosticSelectionSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new InvalidRequestError("Expected --diagnostic to match the canonical atmospheric diagnostic selector", {
      details: { option: "--diagnostic", received: decoded, issues: parsed.error.issues },
    });
  }
  return [...(previous ?? []), parsed.data];
}

export function buildUnifiedQuery(options: Record<string, any>): PublicQueryAtmosphereInput {
  const dataset = parseDataset(options.dataset);
  const geometry = parseGeometry(options);
  const time = parseTime(options);
  const selection = parseSelection(options, dataset);
  const diagnostics = options.diagnostic as DiagnoseAtmosphereInput["diagnostic"][] | undefined;

  return {
    dataset,
    geometry,
    time,
    selection,
    ...forecastInput(dataset, options),
    ...(options.source === undefined ? {} : { source: options.source }),
    ...ensembleInput(dataset, options),
    ...aggregateInput(options),
    ...limitsInput(options),
    ...(diagnostics === undefined || diagnostics.length === 0 ? {} : { diagnostics }),
  };
}

export function buildUnifiedDiagnostic(options: Record<string, any>): DiagnoseAtmosphereInput {
  const dataset = parseDataset(options.dataset);
  const time = parseTime(options);
  const kind = String(options.kind).toLowerCase();

  let diagnostic: DiagnoseAtmosphereInput["diagnostic"];
  if (kind === "layer") {
    if (options.lower === undefined || options.upper === undefined || options.diagnostics === undefined) {
      throw new InvalidRequestError("Layer diagnostics require --lower, --upper and --diagnostics");
    }
    diagnostic = {
      kind: "layer",
      lowerPressureHpa: options.lower,
      upperPressureHpa: options.upper,
      diagnostics: parseStringList(options.diagnostics) as any,
    };
  } else if (kind === "profile") {
    if (options.diagnostics === undefined) {
      throw new InvalidRequestError("Profile diagnostics require --diagnostics");
    }
    diagnostic = {
      kind: "profile",
      pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
      diagnostics: parseStringList(options.diagnostics) as any,
    };
  } else if (kind === "parcel") {
    if (options.parcel === undefined) {
      throw new InvalidRequestError("Parcel diagnostics require --parcel");
    }
    diagnostic = {
      kind: "parcel",
      pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
      parcel: options.parcel,
    } as DiagnoseAtmosphereInput["diagnostic"];
  } else {
    throw new InvalidRequestError(`Expected --kind layer|profile|parcel, received: ${options.kind}`);
  }

  return {
    dataset,
    geometry: { type: "point", latitude: options.lat, longitude: options.lon },
    time,
    diagnostic,
    ...forecastInput(dataset, options),
    ...(options.source === undefined ? {} : { source: options.source }),
    ...ensembleInput(dataset, options),
  };
}

function parseDataset(value: unknown): PublicAtmosphericDataset {
  const normalized = String(value).trim().toLowerCase();
  const parsed = publicAtmosphericDatasetSchema.safeParse(normalized);
  if (parsed.success) return parsed.data;
  throw new InvalidRequestError(
    `Expected --dataset ${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")}, received: ${value}`,
  );
}

function parseGeometry(options: Record<string, any>): QueryAtmosphereInput["geometry"] {
  const modes = [
    options.lat !== undefined || options.lon !== undefined,
    options.point !== undefined,
    options.start !== undefined || options.end !== undefined,
    options.west !== undefined || options.east !== undefined || options.south !== undefined || options.north !== undefined,
  ].filter(Boolean).length;
  if (modes !== 1) {
    throw new InvalidRequestError("Choose exactly one geometry: --lat/--lon, repeatable --point, --start/--end, or --west/--east/--south/--north");
  }

  if (options.lat !== undefined || options.lon !== undefined) {
    if (options.lat === undefined || options.lon === undefined) throw new InvalidRequestError("Point geometry requires both --lat and --lon");
    return { type: "point", latitude: options.lat, longitude: options.lon };
  }
  if (options.point !== undefined) {
    return { type: "points", points: options.point as PointCoordinate[] };
  }
  if (options.start !== undefined || options.end !== undefined) {
    if (options.start === undefined || options.end === undefined) throw new InvalidRequestError("Transect geometry requires both --start and --end");
    return {
      type: "transect",
      start: parseCoordinate(options.start, "--start"),
      end: parseCoordinate(options.end, "--end"),
      ...(options.samples === undefined ? {} : { samples: options.samples }),
    };
  }
  for (const key of ["west", "east", "south", "north"]) {
    if (options[key] === undefined) throw new InvalidRequestError("Area geometry requires --west, --east, --south and --north");
  }
  return {
    type: "area",
    westLongitude: options.west,
    eastLongitude: options.east,
    southLatitude: options.south,
    northLatitude: options.north,
  };
}

function parseTime(options: Record<string, any>): QueryAtmosphereInput["time"] {
  const hasInstant = options.at !== undefined;
  const hasRange = options.from !== undefined || options.to !== undefined;
  if (hasInstant === hasRange) {
    throw new InvalidRequestError("Choose exactly one time form: --at, or --from plus --to");
  }
  if (hasInstant) return { at: String(options.at) };
  if (options.from === undefined || options.to === undefined) throw new InvalidRequestError("Time range requires both --from and --to");
  return {
    from: String(options.from),
    to: String(options.to),
    ...(options.cycles === undefined ? {} : { hoursUtc: parseNumberList(options.cycles, "--cycles") as Array<0 | 6 | 12 | 18> }),
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
  };
}

function parseSelection(
  options: Record<string, any>,
  dataset?: PublicAtmosphericDataset,
): QueryAtmosphereInput["selection"] {
  const fields = options.fields === undefined ? undefined : parseStringList(options.fields);
  const explicitPressure = options.vars !== undefined || options.levels !== undefined;
  if (fields !== undefined && !explicitPressure) return { fields };
  if (!explicitPressure && fields === undefined && isFieldOnlyDataset(dataset)) {
    return { fields: ["temperature_2m"] };
  }
  return {
    variables: parseStringList(options.vars ?? DEFAULT_UNIFIED_VARIABLES),
    pressureLevelsHpa: parseNumberList(options.levels ?? DEFAULT_LEVELS, "--levels"),
    ...(fields === undefined ? {} : { fields }),
  };
}

function isFieldOnlyDataset(dataset: PublicAtmosphericDataset | undefined): boolean {
  return dataset === "arome" || dataset === "pe-arome";
}

function forecastInput(
  dataset: PublicAtmosphericDataset,
  options: Record<string, any>,
): Pick<QueryAtmosphereInput, "forecast"> | {} {
  if (
    publicDatasetMetadata(dataset).role === "analysis"
    || (options.run === undefined && options.grid === undefined && options.forecastKind === undefined)
  ) return {};
  return {
    forecast: {
      ...(options.forecastKind === undefined ? {} : { kind: String(options.forecastKind) as "operational" | "reforecast" }),
      ...(options.run === undefined ? {} : { run: String(options.run) }),
      ...(options.grid === undefined ? {} : { grid: options.grid }),
    },
  };
}

function ensembleInput(dataset: PublicAtmosphericDataset, options: Record<string, any>) {
  const hasEnsemble = options.members !== undefined
    || options.quantiles !== undefined
    || Boolean(options.includeMembers)
    || options.maxMemberSamples !== undefined;
  if (!hasEnsemble) return {};

  const members = options.members === undefined
    ? undefined
    : parseEnsembleMembers(dataset, options.members);

  return {
    ensemble: {
      ...(members === undefined ? {} : { members }),
      ...(options.quantiles === undefined ? {} : { quantiles: parseNumberList(options.quantiles, "--quantiles") }),
      ...(options.includeMembers ? { includeMembers: true } : {}),
      ...(options.maxMemberSamples === undefined ? {} : { maxMemberSamples: options.maxMemberSamples }),
    },
  };
}

function parseEnsembleMembers(
  dataset: PublicAtmosphericDataset,
  value: unknown,
): string[] {
  if (dataset === "gefs") return parseGefsMembers(value);
  if (dataset === "ifs-ens") return parseIfsEnsMembers(value);
  return parseStringList(value);
}

function aggregateInput(options: Record<string, any>) {
  const thresholds = [
    ...(options.gte === undefined ? [] : [{ operator: "gte" as const, value: options.gte }]),
    ...(options.lte === undefined ? [] : [{ operator: "lte" as const, value: options.lte }]),
  ];
  const hasAggregate = options.percentiles !== undefined || thresholds.length > 0 || Boolean(options.extrema);
  if (!hasAggregate) return {};
  return {
    aggregate: {
      ...(options.percentiles === undefined ? {} : { percentiles: parseNumberList(options.percentiles, "--percentiles") }),
      ...(thresholds.length === 0 ? {} : { thresholds }),
      ...(options.extrema ? { includeExtremaLocations: true } : {}),
    },
  };
}

function limitsInput(options: Record<string, any>) {
  const limits = {
    ...(options.maxSamples === undefined ? {} : { maxSamples: options.maxSamples }),
    ...(options.maxPointSteps === undefined ? {} : { maxPointSteps: options.maxPointSteps }),
    ...(options.maxGridPoints === undefined ? {} : { maxGridPoints: options.maxGridPoints }),
    ...(options.maxMemberGridPoints === undefined
      ? {}
      : { maxMemberGridPoints: options.maxMemberGridPoints }),
  };
  return Object.keys(limits).length === 0 ? {} : { limits };
}

function reportCliProgress(progress: AtmosphericStepProgress): void {
  const operation = progress.operation === "points_time_series"
    ? "GFS multi-point time series"
    : "GFS time series";
  const source = progress.source === "s3" ? "AWS S3" : "NOMADS";

  if (progress.phase === "start") {
    const pacing = progress.source === "nomads"
      ? " (cache misses are courtesy-paced)"
      : "";
    console.error(`[wfg] ${operation}: 0/${progress.totalSteps} native steps via ${source}${pacing}`);
    return;
  }

  if (progress.phase === "step") {
    const forecastHour = progress.forecastHour === undefined
      ? ""
      : ` f${String(progress.forecastHour).padStart(3, "0")}`;
    const validTime = progress.validTime === undefined ? "" : ` ${progress.validTime}`;
    const cache = progress.cacheHit === undefined ? "" : progress.cacheHit ? " cache-hit" : " fetched";
    console.error(
      `[wfg] ${operation}: ${progress.completedSteps}/${progress.totalSteps}${forecastHour}${validTime}${cache}`,
    );
    return;
  }

  console.error(`[wfg] ${operation}: done ${progress.totalSteps}/${progress.totalSteps}`);
}

function printResult(result: unknown, json: boolean): void {
  printAtmosphericResult(result, json);
}
